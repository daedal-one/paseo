import { requireNativeViewManager } from "expo-modules-core";
import type { ViewProps } from "react-native";

export interface CanonicalDshViewProps extends ViewProps {
  hostId: string;
  onCarrierError?: (event: { nativeEvent: { code: string } }) => void;
}
/** The native view accepts identity only; credentials remain in Keychain and URLSession. */
export const CanonicalDshView = requireNativeViewManager<CanonicalDshViewProps>("DshCanonical");
