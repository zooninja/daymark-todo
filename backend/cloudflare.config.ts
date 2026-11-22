import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "daymark-alerts",
		compatibilityDate: "2026-11-22",
		entrypoint,
		env: {
			DB: bindings.d1({ name: "daymark-alerts" }),
			APP_ORIGIN: bindings.text("https://zooninja.github.io"),
			APP_URL: bindings.text("https://zooninja.github.io/daymark-todo/"),
			VAPID_SUBJECT: bindings.text("https://github.com/zooninja/daymark-todo"),
			VAPID_PUBLIC_KEY: bindings.text(
				"BKWzGrZd1nvrqBhBMHu86yYXB05dSPlYI_I4MS8w5Qp-13QzVIEo2STnQczZx--e38C4aQf5elogNpRCPJ4ZU6s",
			),
			VAPID_PRIVATE_KEY: bindings.secret(),
		},
		triggers: [triggers.scheduled({ schedule: "* * * * *" })],
		observability: {
			enabled: true,
			logs: { enabled: true, headSamplingRate: 1 },
			traces: { enabled: true, headSamplingRate: 0.1 },
		},
	},
});
