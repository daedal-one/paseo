import { describe, expect, it } from "vitest";

import { resolveFeatureValues } from "./feature-preferences";

describe("feature-preferences", () => {
  const features = [
    {
      type: "toggle" as const,
      id: "fast_mode",
      label: "Fast",
      value: false,
    },
    {
      type: "toggle" as const,
      id: "plan_mode",
      label: "Plan",
      value: false,
    },
  ];

  it("restores persisted values for available features", () => {
    expect(
      resolveFeatureValues({
        features,
        persistedFeatureValues: {
          fast_mode: true,
          unknown_feature: true,
        },
        localFeatureValues: {},
      }),
    ).toEqual({
      fast_mode: true,
    });
  });

  it("prefers local values over persisted values", () => {
    expect(
      resolveFeatureValues({
        features,
        persistedFeatureValues: {
          fast_mode: true,
          plan_mode: false,
        },
        localFeatureValues: {
          fast_mode: false,
        },
      }),
    ).toEqual({
      fast_mode: false,
      plan_mode: false,
    });
  });
});

// DSH composition ids are local to their selected Host; provider preferences are shared.
it("uses Host profile defaults rather than another Host's persisted choice", () => {
  expect(
    resolveFeatureValues({
      features: [
        {
          type: "select",
          id: "dsh.agentPreset",
          label: "Profile",
          value: "host-default",
          options: [],
        },
        { type: "toggle", id: "dsh.modelOverride", label: "Override", value: false },
      ],
      persistedFeatureValues: { "dsh.agentPreset": "other-host", "dsh.modelOverride": true },
      localFeatureValues: {},
    }),
  ).toEqual({ "dsh.agentPreset": "host-default", "dsh.modelOverride": false });
});
it("keeps an explicitly selected removed profile so creation can refuse instead of substituting", () => {
  expect(
    resolveFeatureValues({
      features: [
        {
          type: "select",
          id: "dsh.agentPreset",
          label: "Profile",
          value: "host-default",
          options: [],
        },
      ],
      persistedFeatureValues: {},
      localFeatureValues: { "dsh.agentPreset": "removed" },
    }),
  ).toEqual({ "dsh.agentPreset": "removed" });
});
