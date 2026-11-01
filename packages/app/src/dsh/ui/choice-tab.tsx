import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";

export function ChoiceTab<T extends string>({
  value,
  selected,
  label,
  onSelect,
  testID,
}: {
  value: T;
  selected: T;
  label: string;
  onSelect: (value: T) => void;
  testID?: string;
}) {
  const choose = useCallback(() => onSelect(value), [onSelect, value]);
  const state = useMemo(() => ({ selected: selected === value }), [selected, value]);
  return (
    <Button
      size="sm"
      variant={selected === value ? "secondary" : "ghost"}
      accessibilityRole="tab"
      accessibilityState={state}
      aria-selected={selected === value}
      onPress={choose}
      testID={testID}
    >
      {label}
    </Button>
  );
}
