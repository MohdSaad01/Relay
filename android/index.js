/**
 * @format
 */

// Must be the first import: react-native-gesture-handler patches native event
// handling and has to run before any navigator (or anything else) touches it.
import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
