import type { ViewProps } from "react-native";
export interface CanonicalDshViewProps extends ViewProps {
  hostId: string;
  onCarrierError?: (event: { nativeEvent: { code: string } }) => void;
}
export function CanonicalDshView(_props: CanonicalDshViewProps) {
  return null;
}
