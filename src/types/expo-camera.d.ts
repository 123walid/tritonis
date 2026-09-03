// Temporary ambient declaration so tsc passes before `npm install` pulls in
// expo-camera (~57.0.4). The real types from the package supersede this file
// once node_modules/expo-camera exists (a package's own types win over a
// module declaration only if this file is removed; delete it after install).
declare module 'expo-camera';
