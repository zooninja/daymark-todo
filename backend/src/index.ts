import {
	buildPushPayload,
	type PushSubscription,
	type VapidKeys,
} from "@block65/webcrypto-web-push";

type JsonRecord = Record<string, unknown>;

type PendingReminder = {
	device_id: string;
	id: string;
	title: string;
	due_at: number;
	endpoint: string;
	p256dh: string;
	auth: string;
};

const MAX_BODY_BYTES = 8192;
const MAX_REMINDERS_PER_DEVICE = 500;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60_000;
const ALLOWED_PUSH_HOSTS = new Set([
	"fcm.googleapis.com",
	"updates.push.services.mozilla.com",
	"web.push.apple.com",
]);

function response(body: unknown, status: number, origin: string): Response {
	return Response.json(body, {
		status,
		headers: {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Authorization, Content-Type",
			"Access-Control-Max-Age": "86400",
			Vary: "Origin",
		},
	});
}

function isAllowedOrigin(origin: string, env: Env): boolean {
	return origin === env.APP_ORIGIN;
}

async function readJson(request: Request): Promise<JsonRecord | null> {
	const length = Number(request.headers.get("Content-Length") || 0);
	if (length > MAX_BODY_BYTES) return null;
	if (!request.body) return null;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as JsonRecord)
			: null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

function bearerToken(request: Request): string | null {
	const value = request.headers.get("Authorization");
	if (!value?.startsWith("Bearer ")) return null;
	const token = value.slice(7);
	return /^[A-Za-z0-9_-]{40,100}$/.test(token) ? token : null;
}

async function tokenId(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseSubscription(value: JsonRecord): PushSubscription | null {
	if (typeof value.endpoint !== "string" || value.endpoint.length > 2048) {
		return null;
	}
	let endpoint: URL;
	try {
		endpoint = new URL(value.endpoint);
	} catch {
		return null;
	}
	if (
		endpoint.protocol !== "https:" ||
		endpoint.username ||
		endpoint.password ||
		endpoint.port ||
		!ALLOWED_PUSH_HOSTS.has(endpoint.hostname.toLowerCase())
	) {
		return null;
	}
	if (
		!value.keys ||
		typeof value.keys !== "object" ||
		!("p256dh" in value.keys) ||
		!("auth" in value.keys)
	) {
		return null;
	}
	const keys = value.keys as JsonRecord;
	if (
		typeof keys.p256dh !== "string" ||
		keys.p256dh.length < 40 ||
		keys.p256dh.length > 128 ||
		typeof keys.auth !== "string" ||
		keys.auth.length < 16 ||
		keys.auth.length > 64
	) {
		return null;
	}
	return {
		endpoint: endpoint.href,
		expirationTime: typeof value.expirationTime === "number" ? value.expirationTime : null,
		keys: { p256dh: keys.p256dh, auth: keys.auth },
	};
}

async function registeredDeviceId(request: Request, env: Env): Promise<string | null> {
	const token = bearerToken(request);
	if (!token) return null;
	const id = await tokenId(token);
	const device = await env.DB.prepare("SELECT id FROM devices WHERE id = ?")
		.bind(id)
		.first<{ id: string }>();
	return device ? id : null;
}

function validTaskId(value: string): boolean {
	return /^[A-Za-z0-9._-]{1,80}$/.test(value);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin");
	if (!origin || !isAllowedOrigin(origin, env)) {
		return Response.json({ error: "Origin not allowed." }, { status: 403 });
	}
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": origin,
				"Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Authorization, Content-Type",
				"Access-Control-Max-Age": "86400",
				Vary: "Origin",
			},
		});
	}

	const url = new URL(request.url);
	if (url.pathname === "/api/config" && request.method === "GET") {
		return response({ vapidPublicKey: env.VAPID_PUBLIC_KEY }, 200, origin);
	}

	if (url.pathname === "/api/device" && request.method === "PUT") {
		const token = bearerToken(request);
		if (!token) return response({ error: "Device token required." }, 401, origin);
		const body = await readJson(request);
		const subscription = body && parseSubscription(body);
		if (!subscription) {
			return response({ error: "Invalid push subscription." }, 400, origin);
		}
		const id = await tokenId(token);
		await env.DB.prepare(
			`INSERT INTO devices (id, endpoint, p256dh, auth, created_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   endpoint = excluded.endpoint,
			   p256dh = excluded.p256dh,
			   auth = excluded.auth`,
		)
			.bind(id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, Date.now())
			.run();
		return response({ ok: true }, 200, origin);
	}

	const reminderMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)$/);
	if (reminderMatch) {
		let taskId: string;
		try {
			taskId = decodeURIComponent(reminderMatch[1]);
		} catch (error) {
			if (error instanceof URIError) {
				return response({ error: "Invalid task id." }, 400, origin);
			}
			throw error;
		}
		if (!validTaskId(taskId)) {
			return response({ error: "Invalid task id." }, 400, origin);
		}
		const deviceId = await registeredDeviceId(request, env);
		if (!deviceId) return response({ error: "Device is not registered." }, 401, origin);

		if (request.method === "DELETE") {
			await env.DB.prepare("DELETE FROM reminders WHERE device_id = ? AND id = ?")
				.bind(deviceId, taskId)
				.run();
			return response({ ok: true }, 200, origin);
		}
		if (request.method === "PUT") {
			const body = await readJson(request);
			const dueAt = body?.dueAt;
			const leadMinutes = body?.leadMinutes;
			const title = body?.title;
			if (
				typeof title !== "string" ||
				!title.trim() ||
				title.length > 140 ||
				typeof dueAt !== "number" ||
				!Number.isSafeInteger(dueAt) ||
				dueAt <= Date.now() ||
				typeof leadMinutes !== "number" ||
				!Number.isInteger(leadMinutes) ||
				leadMinutes < 1 ||
				leadMinutes > 10_080
			) {
				return response({ error: "Invalid reminder details." }, 400, origin);
			}
			const count = await env.DB.prepare(
				"SELECT COUNT(*) AS count FROM reminders WHERE device_id = ? AND sent_at IS NULL",
			)
				.bind(deviceId)
				.first<{ count: number }>();
			const alreadyExists = await env.DB.prepare(
				"SELECT id FROM reminders WHERE device_id = ? AND id = ?",
			)
				.bind(deviceId, taskId)
				.first<{ id: string }>();
			if (!alreadyExists && (count?.count ?? 0) >= MAX_REMINDERS_PER_DEVICE) {
				return response({ error: "Too many active reminders on this device." }, 429, origin);
			}
			await env.DB.prepare(
				`INSERT INTO reminders
				   (device_id, id, title, due_at, fire_at, attempts, last_attempt_at, sent_at)
				 VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)
				 ON CONFLICT(device_id, id) DO UPDATE SET
				   title = excluded.title,
				   due_at = excluded.due_at,
				   fire_at = excluded.fire_at,
				   attempts = CASE
				     WHEN reminders.title = excluded.title
				      AND reminders.due_at = excluded.due_at
				      AND reminders.fire_at = excluded.fire_at
				     THEN reminders.attempts ELSE 0 END,
				   last_attempt_at = CASE
				     WHEN reminders.title = excluded.title
				      AND reminders.due_at = excluded.due_at
				      AND reminders.fire_at = excluded.fire_at
				     THEN reminders.last_attempt_at ELSE NULL END,
				   sent_at = CASE
				     WHEN reminders.title = excluded.title
				      AND reminders.due_at = excluded.due_at
				      AND reminders.fire_at = excluded.fire_at
				     THEN reminders.sent_at ELSE NULL END`,
			)
				.bind(deviceId, taskId, title.trim(), dueAt, dueAt - leadMinutes * 60_000)
				.run();
			return response({ ok: true }, 200, origin);
		}
		return response({ error: "Method not allowed." }, 405, origin);
	}

	return response({ error: "Not found." }, 404, origin);
}

async function sendDueReminders(env: Env): Promise<void> {
	const now = Date.now();
	const result = await env.DB.prepare(
		`SELECT r.device_id, r.id, r.title, r.due_at,
		        d.endpoint, d.p256dh, d.auth
		 FROM reminders r
		 JOIN devices d ON d.id = r.device_id
		 WHERE r.sent_at IS NULL
		   AND r.fire_at <= ?
		   AND r.attempts < ?
		   AND (r.last_attempt_at IS NULL OR r.last_attempt_at <= ?)
		 ORDER BY r.fire_at
		 LIMIT 50`,
	)
		.bind(now, MAX_ATTEMPTS, now - RETRY_DELAY_MS)
		.all<PendingReminder>();

	const reminders = result.results ?? [];
	if (!reminders.length) return;
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
		throw new Error("VAPID keys are not configured.");
	}

	const vapid: VapidKeys = {
		subject: env.VAPID_SUBJECT,
		publicKey: env.VAPID_PUBLIC_KEY,
		privateKey: env.VAPID_PRIVATE_KEY,
	};
	for (const reminder of reminders) {
		const subscription = parseSubscription({
			endpoint: reminder.endpoint,
			keys: { p256dh: reminder.p256dh, auth: reminder.auth },
		});
		if (!subscription) {
			console.error(JSON.stringify({ event: "invalid_subscription", id: reminder.id }));
			continue;
		}
		const claimed = await env.DB.prepare(
			`UPDATE reminders
			 SET attempts = attempts + 1, last_attempt_at = ?
			 WHERE device_id = ? AND id = ? AND sent_at IS NULL
			   AND attempts < ?
			   AND (last_attempt_at IS NULL OR last_attempt_at <= ?)`,
		)
			.bind(now, reminder.device_id, reminder.id, MAX_ATTEMPTS, now - RETRY_DELAY_MS)
			.run();
		if (claimed.meta.changes !== 1) continue;
		try {
			const payload = await buildPushPayload(
				{
					data: {
						title: "Daymark · Deadline approaching",
						body: reminder.title,
						tag: `daymark-${reminder.id}`,
						data: {
							taskId: reminder.id,
							dueAt: reminder.due_at,
							url: env.APP_URL,
						},
					},
					options: { ttl: 86_400, urgency: "high" },
				},
				subscription,
				vapid,
			);
			const pushResponse = await fetch(subscription.endpoint, payload);
			if (pushResponse.ok) {
				await env.DB.prepare("UPDATE reminders SET sent_at = ? WHERE device_id = ? AND id = ?")
					.bind(Date.now(), reminder.device_id, reminder.id)
					.run();
			} else if (pushResponse.status === 404 || pushResponse.status === 410) {
				await env.DB.batch([
					env.DB.prepare("DELETE FROM reminders WHERE device_id = ?").bind(reminder.device_id),
					env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(reminder.device_id),
				]);
			} else {
				console.warn(
					JSON.stringify({
						event: "push_delivery_failed",
						taskId: reminder.id,
						status: pushResponse.status,
					}),
				);
			}
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "push_delivery_error",
					taskId: reminder.id,
					message: error instanceof Error ? error.message : "Unknown delivery error",
				}),
			);
		}
	}
}

export default {
	fetch(request, env) {
		return handleRequest(request, env);
	},
	scheduled(_controller, env) {
		return sendDueReminders(env);
	},
} satisfies ExportedHandler<Env>;
