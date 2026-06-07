"use strict";
import config from "config";
import { init } from "./api/webmixer";
import Mapper from "./mapping/SD-mapping";
import { createUserProvider, UserProviderType } from "./api/userProvider";
import secret from "./config/secrets.json";

if (config.has("ignore_channels")) {
  console.log(
    'default.json needs to be updated. "ignore_channels" has been changed to be channels. Instead of a list of "channels" to ignore please add the channels that you would like to include.'
  );
  process.exit();
}

if (!config.has("channels")) {
  console.log(
    'default.json file does not contain channels key. Please add it to continue. If you don\'t know the channels to use please add a blank array ("channels": []).'
  );
  process.exit();
}

if (!config.has("desk.receive_port")) {
  console.log("default.json must include the desk.receive_port");
  process.exit();
}

if (config.has("desk.channel_count")) {
  console.warn(
    "desk.channel_count is no longer necessary. This config entry has been ignored."
  );
}

let type = "SD";
if (config.has("desk.type")) {
  type = config.get("desk.type");
}

console.log("Loading DiGiCo " + type + " configuration");

const SKIP = process.argv.indexOf("skip") !== -1;

const userProviderType: UserProviderType = SKIP
  ? "offline"
  : config.has("userProvider.type")
    ? config.get("userProvider.type")
    : config.has("planningCenter")
      ? "planningCenter"
      : "offline";

const userProvider = createUserProvider({
  type: userProviderType,
  churchsuite: config.has("churchsuite")
    ? config.get("churchsuite")
    : undefined,
  planningCenter:
    userProviderType === "planningCenter" && config.has("planningCenter")
      ? {
          ...(config.get("planningCenter") as {
            baseUrl: string;
            worshipTeamId: string;
          }),
          appId: (secret as { planningCenter: { appId: string; secret: string } })
            .planningCenter.appId,
          secret: (secret as { planningCenter: { appId: string; secret: string } })
            .planningCenter.secret,
        }
      : undefined,
  secrets: secret as {
    churchsuite?: { username: string; password: string };
    planningCenter?: { appId: string; secret: string };
  },
});

init(
  config.get("desk.send_port"),
  config.get("desk.receive_port"),
  config.get("desk.ip"),
  config.get("aux"),
  config.get("channels"),
  config.get("server.port"),
  new Mapper(config),
  config.get("auth"),
  userProvider,
);
