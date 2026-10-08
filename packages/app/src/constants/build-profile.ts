import { Platform } from "react-native";
import Constants from "expo-constants";

/** F-Droid build without proprietary camera or notification dependencies. */
export const isFdroidBuild = Constants.expoConfig?.extra?.fdroidBuild === true;

/** Production-like Android build with local profiling enabled. */
export const isProfileBuild = Constants.expoConfig?.extra?.profileBuild === true;

/** Daedal companion uses the native DSH conversation directory at startup. */
export const isDshClient =
  Constants.expoConfig?.extra?.dshClient === true && Platform.OS !== "android";
