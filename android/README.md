This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

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

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
