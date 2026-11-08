// What every parity run's homeserver holds: the same people, rooms and messages each time,
// sent in the same order, so both apps show the same content. The signed-in user is
// "alice"; the others write to her.
import { PNG } from "pngjs";
import { MESSAGES } from "#fixtures";
import type { ParitySession, SeedData } from "#protocol";

const PASSWORD = "parity-password";

class Account {
  readonly homeserver: string;
  readonly userId: string;
  readonly accessToken: string;

  constructor(homeserver: string, userId: string, accessToken: string) {
    this.homeserver = homeserver;
    this.userId = userId;
    this.accessToken = accessToken;
  }

  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    contentType = "application/json",
  ): Promise<T> {
    const response = await fetch(`${this.homeserver}/_matrix${path}`, {
      method,
      headers: { authorization: `Bearer ${this.accessToken}`, "content-type": contentType },
      body:
        body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
    const json = (await response.json()) as T;
    if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
    return json;
  }

  async createRoom(options: Record<string, unknown>): Promise<string> {
    const { room_id } = await this.request<{ room_id: string }>(
      "POST",
      "/client/v3/createRoom",
      options,
    );
    return room_id;
  }

  async join(roomId: string): Promise<void> {
    await this.request("POST", `/client/v3/join/${encodeURIComponent(roomId)}`, {});
  }

  async state(roomId: string, type: string, key: string, content: unknown): Promise<void> {
    await this.request(
      "PUT",
      `/client/v3/rooms/${encodeURIComponent(roomId)}/state/${type}/${encodeURIComponent(key)}`,
      content,
    );
  }

  private transaction = 0;

  async send(
    roomId: string,
    content: Record<string, unknown>,
    type = "m.room.message",
  ): Promise<string> {
    this.transaction += 1;
    const { event_id } = await this.request<{ event_id: string }>(
      "PUT",
      `/client/v3/rooms/${encodeURIComponent(roomId)}/send/${type}/parity-${this.transaction}`,
      content,
    );
    return event_id;
  }

  text(roomId: string, body: string, extra: Record<string, unknown> = {}): Promise<string> {
    return this.send(roomId, { msgtype: "m.text", body, ...extra });
  }

  react(roomId: string, eventId: string, key: string): Promise<string> {
    return this.send(
      roomId,
      { "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key } },
      "m.reaction",
    );
  }

  async upload(bytes: Uint8Array, contentType: string, filename: string): Promise<string> {
    const { content_uri } = await this.request<{ content_uri: string }>(
      "POST",
      `/media/v3/upload?filename=${encodeURIComponent(filename)}`,
      bytes,
      contentType,
    );
    return content_uri;
  }

  async profile(displayName: string, avatarUrl?: string): Promise<void> {
    const user = encodeURIComponent(this.userId);
    await this.request("PUT", `/client/v3/profile/${user}/displayname`, {
      displayname: displayName,
    });
    if (avatarUrl !== undefined) {
      await this.request("PUT", `/client/v3/profile/${user}/avatar_url`, { avatar_url: avatarUrl });
    }
  }
}

async function register(homeserver: string, username: string): Promise<Account> {
  const response = await fetch(`${homeserver}/_matrix/client/v3/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: "m.login.dummy" },
      inhibit_login: false,
      initial_device_display_name: "Seed",
    }),
  });
  const json = (await response.json()) as { user_id?: string; access_token?: string };
  if (!response.ok || json.user_id === undefined || json.access_token === undefined) {
    throw new Error(`Registering ${username}: ${JSON.stringify(json)}`);
  }
  return new Account(homeserver, json.user_id, json.access_token);
}

/** A device for one app: both apps sign in as alice, each with its own device. */
export async function signIn(seed: SeedData, deviceId: string): Promise<ParitySession> {
  const response = await fetch(`${seed.homeserverUrl}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: "alice" },
      password: seed.password,
      device_id: deviceId,
      initial_device_display_name: "Parity",
    }),
  });
  const json = (await response.json()) as {
    user_id: string;
    access_token: string;
    device_id: string;
  };
  if (!response.ok) throw new Error(`Signing in: ${JSON.stringify(json)}`);
  return {
    userId: json.user_id,
    accessToken: json.access_token,
    deviceId: json.device_id,
    homeserverUrl: seed.homeserverUrl,
  };
}

/** A PNG of horizontal bands, so images have content to compare. */
function picture(width: number, height: number, colors: [number, number, number][]): Uint8Array {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const [r, g, b] = colors[Math.floor((y / height) * colors.length)] ?? [0, 0, 0];
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      png.data[index] = r;
      png.data[index + 1] = g;
      png.data[index + 2] = b;
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export async function seedHomeserver(homeserver: string): Promise<SeedData> {
  const alice = await register(homeserver, "alice");
  const bob = await register(homeserver, "bob");
  const carol = await register(homeserver, "carol");
  const dave = await register(homeserver, "dave");

  const bobAvatar = await bob.upload(
    picture(96, 96, [
      [88, 101, 242],
      [235, 69, 158],
    ]),
    "image/png",
    "bob.png",
  );
  await alice.profile("Alice");
  await bob.profile("Bob", bobAvatar);
  await carol.profile("Carol");
  await dave.profile("Dave");

  const publicRoom = (name: string, topic?: string): Record<string, unknown> => ({
    name,
    topic,
    preset: "public_chat",
    invite: [alice.userId, carol.userId, dave.userId],
  });

  // A space with two rooms, made by Bob.
  const space = await bob.createRoom({
    ...publicRoom("Design Team", "Where the design team works"),
    creation_content: { type: "m.space" },
  });
  const general = await bob.createRoom(publicRoom("general", "Company-wide chatter"));
  const random = await bob.createRoom(publicRoom("random"));
  for (const child of [general, random]) {
    await bob.state(space, "m.space.child", child, { via: ["localhost"] });
    await bob.state(child, "m.space.parent", space, { via: ["localhost"], canonical: true });
  }
  const announcements = await bob.createRoom(publicRoom("Announcements", "News from the office"));
  for (const account of [alice, carol, dave]) {
    for (const room of [space, general, random, announcements]) await account.join(room);
  }

  // A direct chat between Bob and Alice.
  const dm = await bob.createRoom({
    preset: "trusted_private_chat",
    is_direct: true,
    invite: [alice.userId],
  });
  await alice.join(dm);
  await alice.request(
    "PUT",
    `/client/v3/user/${encodeURIComponent(alice.userId)}/account_data/m.direct`,
    { [bob.userId]: [dm] },
  );
  await bob.request(
    "PUT",
    `/client/v3/user/${encodeURIComponent(bob.userId)}/account_data/m.direct`,
    { [alice.userId]: [dm] },
  );

  // An invitation Alice hasn't answered.
  const invite = await carol.createRoom({
    name: "Book Club",
    preset: "private_chat",
    invite: [alice.userId],
  });

  // #general: the message types the timeline renders differently.
  const welcome = await bob.text(general, "Welcome to the team chat! 👋");
  const morning = await carol.text(general, "Morning, everyone.");
  const hello = await alice.text(general, "Hi all, glad to be here.");
  const plan = await bob.text(
    general,
    "Here's the plan for this week:\n- Ship the parity test\n- Fix the drawer",
    {
      format: "org.matrix.custom.html",
      formatted_body:
        "Here's the <strong>plan</strong> for this week:<ul><li>Ship the parity test</li><li>Fix the drawer</li></ul>",
    },
  );
  await carol.text(general, "Sounds good to me.", {
    "m.relates_to": { "m.in_reply_to": { event_id: plan } },
  });
  await dave.text(general, "Use `vpx _parity` and see https://example.org for details.", {
    format: "org.matrix.custom.html",
    formatted_body:
      'Use <code>vpx _parity</code> and see <a href="https://example.org">example.org</a> for details.',
  });
  await bob.send(general, { msgtype: "m.emote", body: "waves at everyone" });
  const imageUrl = await carol.upload(
    picture(320, 180, [
      [242, 63, 67],
      [240, 178, 50],
      [35, 165, 89],
      [88, 101, 242],
    ]),
    "image/png",
    "bands.png",
  );
  const image = await carol.send(general, {
    msgtype: "m.image",
    body: "bands.png",
    url: imageUrl,
    info: { w: 320, h: 180, mimetype: "image/png", size: 0 },
  });
  await alice.text(general, MESSAGES.long);
  await carol.send(general, {
    msgtype: "m.text",
    body: " * Good morning, everyone!",
    "m.new_content": { msgtype: "m.text", body: "Good morning, everyone!" },
    "m.relates_to": { rel_type: "m.replace", event_id: morning },
  });
  await alice.react(general, welcome, "👍");
  await carol.react(general, welcome, "👍");
  await bob.react(general, hello, "❤️");
  const threadRoot = await bob.text(general, "Thread: notes from the weekly sync");
  const thread = {
    "m.relates_to": {
      rel_type: "m.thread",
      event_id: threadRoot,
      is_falling_back: true,
      "m.in_reply_to": { event_id: threadRoot },
    },
  };
  await carol.text(general, "I'll take the drawer.", thread);
  await alice.text(general, "And I'll write the parity views.", thread);
  await dave.text(general, MESSAGES.lunch);

  await dave.text(random, "Anyone up for lunch?");
  await bob.text(random, "Sure!");

  const pinned = await bob.text(announcements, "The office is closed on Friday.");
  await bob.state(announcements, "m.room.pinned_events", "", { pinned: [pinned] });
  await carol.text(announcements, "Thanks for the heads-up.");

  await bob.text(dm, "Hey Alice, got a minute?");
  await alice.text(dm, "Sure, what's up?");
  await bob.text(dm, "Can you review the parity test today?");

  return {
    homeserverUrl: homeserver,
    userId: alice.userId,
    password: PASSWORD,
    users: { alice: alice.userId, bob: bob.userId, carol: carol.userId, dave: dave.userId },
    rooms: { space, general, random, announcements, dm, invite },
    events: { welcome, hello, plan, image, threadRoot, pinned },
  };
}
