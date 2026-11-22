import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vite-plus/test";

const APP_ORIGIN = "https://zooninja.github.io";
const DEVICE_TOKEN = "a".repeat(43);
const SUBSCRIPTION = {
	endpoint: "https://fcm.googleapis.com/fcm/send/test",
	expirationTime: null,
	keys: {
		p256dh: "B".repeat(65),
		auth: "c".repeat(24),
	},
};

async function request(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("Origin", APP_ORIGIN);
	return SELF.fetch(`https://daymark-alerts.test${path}`, {
		...init,
		headers,
	});
}

beforeAll(async () => {
	await env.DB.prepare(
		`CREATE TABLE IF NOT EXISTS devices (
			id TEXT PRIMARY KEY,
			endpoint TEXT NOT NULL,
			p256dh TEXT NOT NULL,
			auth TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
	).run();
	await env.DB.prepare(
		`CREATE TABLE IF NOT EXISTS reminders (
			device_id TEXT NOT NULL,
			id TEXT NOT NULL,
			title TEXT NOT NULL,
			due_at INTEGER NOT NULL,
			fire_at INTEGER NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			last_attempt_at INTEGER,
			sent_at INTEGER,
			PRIMARY KEY (device_id, id)
		)`,
	).run();
});

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM reminders").run();
	await env.DB.prepare("DELETE FROM devices").run();
});

it("returns public push configuration only to the app origin", async () => {
	const response = await request("/api/config");
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		vapidPublicKey:
			"BKWzGrZd1nvrqBhBMHu86yYXB05dSPlYI_I4MS8w5Qp-13QzVIEo2STnQczZx--e38C4aQf5elogNpRCPJ4ZU6s",
	});

	const denied = await SELF.fetch("https://daymark-alerts.test/api/config", {
		headers: { Origin: "https://untrusted.example" },
	});
	expect(denied.status).toBe(403);
});

it("rejects reminder writes from unregistered devices", async () => {
	const response = await request("/api/reminders/task-1", {
		method: "PUT",
		headers: { Authorization: `Bearer ${DEVICE_TOKEN}` },
		body: JSON.stringify({
			title: "Prepare report",
			dueAt: Date.now() + 60_000,
			leadMinutes: 15,
		}),
	});
	expect(response.status).toBe(401);
});

it("registers a device, stores a reminder, and cancels it", async () => {
	const dueAt = Date.now() + 3_600_000;
	const registered = await request("/api/device", {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${DEVICE_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(SUBSCRIPTION),
	});
	expect(registered.status).toBe(200);

	const reminder = await request("/api/reminders/task-1", {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${DEVICE_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			title: "Prepare report",
			dueAt,
			leadMinutes: 15,
		}),
	});
	expect(reminder.status).toBe(200);
	const stored = await env.DB.prepare("SELECT title, fire_at FROM reminders").first<{
		title: string;
		fire_at: number;
	}>();
	expect(stored?.title).toBe("Prepare report");
	expect(stored?.fire_at).toBeGreaterThan(Date.now());

	await env.DB.prepare("UPDATE reminders SET sent_at = ?").bind(Date.now()).run();
	const repeatedSync = await request("/api/reminders/task-1", {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${DEVICE_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			title: "Prepare report",
			dueAt,
			leadMinutes: 15,
		}),
	});
	expect(repeatedSync.status).toBe(200);
	const stillSent = await env.DB.prepare("SELECT sent_at FROM reminders").first<{
		sent_at: number;
	}>();
	expect(stillSent?.sent_at).not.toBeNull();

	const deleted = await request("/api/reminders/task-1", {
		method: "DELETE",
		headers: { Authorization: `Bearer ${DEVICE_TOKEN}` },
	});
	expect(deleted.status).toBe(200);
	expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM reminders").first()).toMatchObject({
		count: 0,
	});
});

it("rejects push endpoints outside supported public services", async () => {
	const response = await request("/api/device", {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${DEVICE_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			...SUBSCRIPTION,
			endpoint: "https://127.0.0.1/private",
		}),
	});
	expect(response.status).toBe(400);
});
