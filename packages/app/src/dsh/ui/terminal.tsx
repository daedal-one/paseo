import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { randomUUID } from "expo-crypto";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { encodeTerminalOutput } from "@/terminal/runtime/terminal-output";
import TerminalEmulator from "@/components/terminal-emulator";
import type { TerminalEmulatorHandle } from "@/components/terminal-emulator-contract";
import { Button } from "@/components/ui/button";
import type { DshHostRuntime, DshConversation } from "../runtime";
import { DshTerminal } from "../terminal";
import { featureAvailable } from "../features";
import { styles } from "./styles";
function TerminalSheet({
  runtime,
  view,
  onClose,
}: {
  runtime: DshHostRuntime;
  view: DshConversation;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const header = useMemo(() => ({ title: t("nativeDsh.features.terminal") }), [t]);
  const [terminal] = useState(() => new DshTerminal(runtime, view.sessionId, randomUUID));
  const snapshot = useSyncExternalStore(terminal.subscribe, terminal.getSnapshot);
  const emulator = useRef<TerminalEmulatorHandle>(null);
  const cursor = useRef(0);
  const resize = useCallback(
    (size: { rows: number; cols: number }) => {
      terminal.start(size.rows, size.cols);
      terminal.resize(size.rows, size.cols);
    },
    [terminal],
  );
  const ready = useCallback(
    (state: { isReady: boolean }) => {
      if (state.isReady) {
        const current = terminal.getSnapshot();
        emulator.current?.restoreOutput(encodeTerminalOutput(current.text));
        cursor.current = current.offset + current.text.length;
      }
    },
    [terminal],
  );
  useEffect(() => {
    if (cursor.current < snapshot.offset)
      emulator.current?.restoreOutput(encodeTerminalOutput(snapshot.text));
    else
      emulator.current?.writeOutput(
        encodeTerminalOutput(snapshot.text.slice(cursor.current - snapshot.offset)),
      );
    cursor.current = snapshot.offset + snapshot.text.length;
  }, [snapshot]);
  useEffect(
    () => () => {
      void terminal.dispose();
    },
    [terminal],
  );
  return (
    <AdaptiveModalSheet visible header={header} onClose={onClose} testID="dsh-terminal-sheet">
      <View style={styles.terminal}>
        <Text style={styles.muted}>{t(`nativeDsh.terminal.${snapshot.status}`)}</Text>
        <TerminalEmulator
          ref={emulator}
          streamKey={`${runtime.hostId}:${view.sessionId}`}
          supportsTerminalInputModeReplay={false}
          scrollbackLines={1000}
          onInput={terminal.input}
          onResize={resize}
          onRendererReadyChange={ready}
          testId="dsh-terminal-emulator"
        />
      </View>
    </AdaptiveModalSheet>
  );
}
export function TerminalControl({
  runtime,
  view,
}: {
  runtime: DshHostRuntime;
  view: DshConversation;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  useSyncExternalStore(
    runtime.connection.generation.subscribe,
    runtime.connection.generation.getSnapshot,
  );
  const available = featureAvailable(runtime, [
    "session/terminal",
    "session/terminalInput",
    "session/terminalResize",
  ]);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={!available}
        onPress={show}
        testID="dsh-terminal-open"
      >
        {t("nativeDsh.features.terminal")}
      </Button>
      {open && <TerminalSheet runtime={runtime} view={view} onClose={close} />}
    </>
  );
}
