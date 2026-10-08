import { useEffect, useState, useSyncExternalStore } from "react";
import { DshRegistrationForm } from "./registration-form";
import type { DshHostRuntime } from "./runtime";

/** Attach one form per mounted sheet; closing only releases its readers. */
export function useRegistrationForm(runtime: DshHostRuntime) {
  const [form] = useState(() => new DshRegistrationForm(runtime.registration, runtime.workspaces));
  useEffect(() => form.connect(), [form]);
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot);
  return { form, state };
}
