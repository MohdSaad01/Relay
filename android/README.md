Relay's Android client — a [**React Native**](https://reactnative.dev)
(TypeScript) app. Android only in Version 1 (`docs/03_Tech_Stack.md`) —
there is no iOS setup in this project.

# Getting Started

Complete the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment)
guide first, then from this directory:

```sh
npm install
npm start        # Metro dev server, in one terminal
npm run android   # build + run, in another terminal (device/emulator required)
```

Fast Refresh applies automatically after a change; for a full reload,
press <kbd>R</kbd> twice or use the Dev Menu (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>M</kbd>).

Run tests: `npm test`. Lint: `npm run lint`. Type-check: `npm run typecheck`.

If the standard steps above don't work, see React Native's own
[Troubleshooting](https://reactnative.dev/docs/troubleshooting) page — the
section below covers this project's own Windows-specific build issue,
which is not a generic React Native problem.

## Windows: native build requirements

Building the Android app on Windows needs a few things beyond a standard
React Native setup, because of how this project's native (C++) build is
configured. This section documents that setup and the reasoning behind it.

### Requirements

- **JDK 17.** The Android Gradle Plugin resolved for this project (AGP
  8.12.0, pinned in `node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml`)
  and the Gradle version it runs under require JDK 17 to execute Gradle
  itself — it's the toolchain version this project's Gradle/Kotlin setup
  (`kotlinVersion = "2.1.20"` in `android/build.gradle`) is built against.
  Older JDKs aren't supported by this AGP version; newer ones aren't
  guaranteed compatible.
- **Windows Long Paths enabled.** Required in general for Node/npm and
  Android/Gradle build output on Windows, since `node_modules` plus Gradle's
  `.cxx`/`build` intermediate directories routinely produce paths well past
  Windows' historical 260-character `MAX_PATH` limit.
- **Android Studio and the Android SDK**, with:
  - `compileSdk`/`targetSdk` 36 and NDK `27.1.12297006` (see
    `android/build.gradle` — installed automatically by Gradle/AGP if
    missing, but the SDK itself must be present and `ANDROID_HOME`/
    `local.properties` must point to it).
  - **CMake 4.1.2** installed via the SDK Manager (Android Studio → SDK
    Manager → SDK Tools → check "Show Package Details" under CMake → select
    `4.1.2`; or `sdkmanager --install "cmake;4.1.2"`). This is required —
    see below for why.

### Background: the "Filename longer than 260 characters" ninja error

On a fresh Windows setup, `npm run android` can fail native compilation
with:

```
ninja: error: Filename longer than 260 characters
```

**Root cause.** This project's native build (the New Architecture's
codegen, unified into a single CMake build owned by `:app` —
`android/app/build.gradle`) compiles source files reached through deeply
nested paths under `node_modules/<library>/...`. AGP's C/C++ build system
generates object-file paths by combining its own `.cxx` intermediate
directory, the CMake target's build folder, and the *absolute* source path
of each `.cpp` file (Windows lacks a build-relative path scheme CMake can
use here). Once a library's codegen sources live several directories deep
inside `node_modules`, the resulting object-file path — CMake/Ninja's
build directory prefix plus the full absolute source path — exceeds
Windows' legacy 260-character path limit, and the CMake 3.22.1 toolchain's
bundled `ninja.exe` fails to open the file even with Long Paths enabled at
the OS level, because it doesn't opt in to the `\\?\` long-path prefix
Windows requires for paths over that length.

**Why AGP selected CMake 3.22.1.** `android/app/build.gradle` never
declared an `externalNativeBuild.cmake.version`. React Native's own Gradle
plugin (`NdkConfiguratorUtils.configureReactNativeNdk`, in
`node_modules/@react-native/gradle-plugin`) injects a default
`CMakeLists.txt` *path* for the app module if one isn't set, but it never
sets a `version` — so with no version pinned anywhere in project code, AGP
silently fell back to its own bundled default CMake (3.22.1) and had
Gradle's SDK manager install and use it, regardless of any newer CMake
already present on the machine. This is AGP's normal, documented behavior
when a module's `cmake {}` block omits `version`; it isn't a bug or a
project misconfiguration elsewhere.

**Why pinning CMake 4.1.2 in `android/app/build.gradle` fixes it.** Adding
an explicit `externalNativeBuild { cmake { version "4.1.2" } }` to the
`android {}` block in `android/app/build.gradle` (a file this project owns)
makes AGP use the newer, already-installed CMake — and its `ninja.exe` —
for the app's native build instead of resolving its own default. CMake's
Ninja generator in newer releases correctly emits Windows extended-length
(`\\?\`)-prefixed paths for build artifacts, so the same long object-file
paths that failed under 3.22.1's bundled Ninja build without error under
4.1.2. `android/build.gradle` (the root project file) was left unchanged;
the fix lives entirely in the app module, which is the only module whose
native build actually produces the long paths that were failing.

**Why `node_modules` was left unmodified.** Two of the autolinked native
modules (`react-native-screens`, `react-native-gesture-handler`) also omit
`externalNativeBuild.cmake.version` in their own `android/build.gradle`,
and their own standalone native builds (building their own `.so`, separate
from the codegen unified into `:app`) still resolve to CMake 3.22.1.
They were **not** patched to pin a version, because:
- `node_modules` is regenerated by `npm install` and is not meant to hold
  project-specific edits — any change there is silently lost on the next
  clean install and isn't visible to other developers or CI.
- Their own build output paths are short enough (they don't route through
  the same deeply-nested `node_modules/<library>/shared/...` codegen tree
  that `:app`'s unified build does) that they don't hit the 260-character
  limit in practice, even on 3.22.1. There was no observed failure to fix
  there.
- A working, general cross-project fix (forcing every subproject's CMake
  version from the root `build.gradle`, via AGP's `finalizeDsl` variant
  API) was attempted and did not reliably take effect for this project's
  specific Gradle evaluation order (React Native's own root plugin forces
  `:app` to evaluate before other subprojects, via
  `evaluationDependsOn(":app")`), so it was reverted rather than shipped
  half-working. If a library's own native build ever does hit this error,
  the fix belongs in that library's own `android/build.gradle` (or an
  upstream fix/PR to that library), not a patch inside `node_modules`.

**Why replacing `ninja.exe` manually was rejected.** Swapping the
`ninja.exe` binary inside the SDK's `cmake/3.22.1/bin/` folder for a newer
one was considered and rejected:
- It's invisible to Gradle/AGP's own SDK component tracking, so a future
  Android Studio SDK sync, `sdkmanager` update, or teammate's fresh SDK
  install silently reverts it — the fix wouldn't survive normal tooling
  operations.
- It doesn't address *why* 3.22.1 gets selected; the same failure would
  resurface the moment any other native module or a future RN upgrade
  triggers a fresh `cmake;3.22.1` install.
- It's unsupported and undocumented by Google/AGP, and isn't reproducible
  by another developer or CI without them independently discovering and
  repeating the same manual step.
- The project-level fix (pinning `cmake.version` in `android/app/build.gradle`)
  achieves the same result through an officially supported, documented AGP
  mechanism, and is version-controlled like any other project setting.

# Learn More

- [React Native Website](https://reactnative.dev)
- [Docs](https://reactnative.dev/docs/getting-started)
- [`@facebook/react-native`](https://github.com/facebook/react-native) — GitHub repository
