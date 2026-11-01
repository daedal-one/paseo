import { Redirect } from "expo-router";

/** The workspace client owns its own connection and enrollment states. */
export default function Index() {
  return <Redirect href="/workspace" />;
}
