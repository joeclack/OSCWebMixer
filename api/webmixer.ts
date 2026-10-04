import path from "path";
import Mapper from "../mapping/SD-mapping";

import QRCodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import osc from "osc";
import cliProgress from "cli-progress";
import express, { Application } from "express";
import http from "http";
import WebSocket from "ws";
import os from "os";
import prompts from "prompts";
import { faker } from "@faker-js/faker";
import {
  UserProvider,
  ServiceRef,
  RotaMember,
  buildRotaPeople,
  findAuxChannelForRole,
  findMemberAssignments,
  isPlanningCenterProvider,
  mapMembersToAuxs,
} from "./userProvider";

type AuxConfig = {
  label: string | null;
  channel: number;
  stereo: boolean;
  colour: string;
  extraRoleNames?: string[];
  extraPlanningCenterNames?: string[];
};

type GetAuthQuery = {
  "aux?": number;
};
type SetAuxRequest = {
  aux: number;
  channel: number;
  level?: number;
  pan?: number;
};
type IdentifyRequest = {
  identify: string;
  role?: string;
};
type ClientMessage = GetAuthQuery | SetAuxRequest | IdentifyRequest;

type ClientLogEntry = {
  at: number;
  type: "aux" | "level" | "pan";
  aux: number;
  auxLabel: string | null;
  channel?: number;
  channelLabel?: string | null;
  value: number;
  previousValue?: number | null;
};

// not used
type AuthConfig = {
  enabled: boolean;
  users: {
    username: string;
    password: string;
    access: {
      auxes: number[];
    };
  }[];
};

export const init = async (
  localPort: number,
  remotePort: number,
  remoteAddress: string,
  auxs: AuxConfig[],
  supportedChannels: number[],
  serverPort: number,
  mapping: Mapper,
  auth: AuthConfig,
  userProvider: UserProvider,
) => {
  let appResources = path.join(__dirname, "..", "web");

  const SKIP = process.argv.indexOf("skip") !== -1;
  const DEBUG = process.argv.indexOf("debug") !== -1;

  console.log("Skip: ", SKIP, "Debug: ", DEBUG);

  let offlineMode = SKIP;
  let rotaMembers: RotaMember[] = [];
  let chosenService: ServiceRef | null = null;

  if (!SKIP) {
    try {
      const services = await userProvider.listServices();
      if (services.length === 0) {
        const ans = await prompts({
          type: "confirm",
          name: "offline",
          message: "No upcoming services found. Continue in offline mode?",
        });
        offlineMode = Boolean(ans.offline);
      } else {
        const chosen = await prompts({
          type: "select",
          name: "service",
          message: "Choose a service",
          choices: services.map((service) => ({
            title: service.label,
            value: service,
          })),
        });

        if (!chosen.service) {
          offlineMode = true;
        } else {
          chosenService = chosen.service;
          rotaMembers = await userProvider.getRotaMembers(chosen.service);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown provider error";
      const ans = await prompts({
        type: "confirm",
        name: "offline",
        message: `User provider fetch failed (${message}). Continue in offline mode?`,
      });
      offlineMode = Boolean(ans.offline);
    }
  }

  const rotaPeople = buildRotaPeople(rotaMembers);
  const auxList = mapMembersToAuxs(auxs, rotaMembers);

  const SessionId = createSessionId();

  /**
   * The total number of parameters that need to load.
   * @type {Int}
   */
  let totalParamsToLoad = 0;

  /**
   * All of the channels for the AUXs
   * @type [Int]
   */
  let auxChannels: number[] = [];

  //add all aux channels to the channel numbers
  for (let aux of auxList) {
    auxChannels.push(aux.channel);
    aux.label = null; //reset all labels
    totalParamsToLoad++; //need to fetch the aux labels
  }

  type OSCValue = { level: null | number; pan?: null | number };
  /**
   * All the OSC address:values that have been saved since the server started
   */
  let values: Record<string, OSCValue> = {};

  // pre-populate values with default data
  for (const element of supportedChannels) {
    for (let auxIndex = 0; auxIndex < auxList.length; auxIndex++) {
      let data: OSCValue = {
        level: null,
      };
      totalParamsToLoad++;

      if (auxList[auxIndex].stereo != undefined && auxList[auxIndex].stereo) {
        data.pan = null;
        totalParamsToLoad++;
      }

      values["a" + auxList[auxIndex].channel + "|c" + element] = data;
    }
  }

  /**
   * Socket connections that have connected
   */
  type ClientConnection = {
    id: number;
    socket: WebSocket;
    connectedAt: number;
    lastActivity: number;
    aux: number | null;
    personId: string | null;
    personName: string | null;
    address: string | null;
    log: ClientLogEntry[];
  };

  type AdminClient = {
    id: number;
    address: string | null;
    connectedAt: number;
    lastActivity: number;
    disconnectedAt: number | null;
    aux: number | null;
    auxLabel: string | null;
    auxColour: string | null;
    personName: string | null;
    levels: ReturnType<typeof getClientLevels> | null;
    log: ClientLogEntry[];
  };

  let connections: ClientConnection[] = [];
  let disconnectedClients: AdminClient[] = [];
  let nextClientId = 1;

  type Channel = {
    label: null | string;
    channel: number;
  };
  /**
   * The channels that are available to mix.
   */
  let channels: Channel[] = [];

  //populate channels with blank values
  for (let chan of supportedChannels) {
    channels.push({
      label: null,
      channel: chan,
    });
    totalParamsToLoad++;
  }

  /**
   * Get the IP addresses for this device on the network.
   */
  const getIPAddresses = () => {
    const interfaces = os.networkInterfaces(),
      ipAddresses = [];

    for (let deviceName in interfaces) {
      let addresses = interfaces[deviceName];
      if (!addresses) continue;
      for (let i = 0; i < addresses.length; i++) {
        let addressInfo = addresses[i];
        if (addressInfo.family === "IPv4" && !addressInfo.internal) {
          ipAddresses.push(addressInfo.address);
        }
      }
    }
    return ipAddresses;
  };

  let ipAddresses = getIPAddresses();
  let glowAudioIp = ipAddresses.find((x) => x.startsWith("192.168.6"));
  // if (SKIP) glowAudioIp = ipAddresses[0];

  //if (!glowAudioIp) throw new Error("NO IP FOUND FOR GLOW AUDIO");
  // if (!glowAudioIp.endsWith("7"))
  //  console.info(
  //    "GLOW AUDIO IP DOES NOT END WITH 7 - DOES IT MATCH THE CONSOLE"
  //  );

  if (!offlineMode && chosenService && isPlanningCenterProvider(userProvider)) {
    await userProvider
      .getFetcher()
      .setPlanNote(
        `EARS MIXER URL: \n\n ${getWebAppUrl()}`,
        String(chosenService.meta?.plan ?? chosenService.id),
        String(chosenService.meta?.serviceType ?? ""),
      );
  }

  /*
	Progress bar to load desk values
	*/
  const loadingProgress = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic,
  );

  // Bind to a UDP socket to listen for incoming OSC events.
  let udpPort = new osc.UDPPort({
    localAddress: ipAddresses[0], //glowAudioIp,
    localPort: localPort,
    remotePort: remotePort,
    remoteAddress: remoteAddress,
  });

  udpPort.on("error", function (err: any) {
    console.error("UDP error", err);
  });

  let loadingAddresses = mapping.getLoadingAddresses(
    auxList,
    supportedChannels,
  );

  udpPort.on("ready", function () {
    console.log("Loading Desk Values...");

    loadingProgress.start(totalParamsToLoad, 0);

    // if (SKIP) {
    //   loadingProgress.update(totalParamsToLoad);
    //   loadingProgress.stop();

    //   udpPort.off("message", loadingMessages);
    //   udpPort.on("message", loadedMessages);

    //   startServer();
    //   return;
    // }

    /*
		Start loading values from the desk
		It seems that you can't ask for all of these addresses at once on an SD9 console.
		If you do this the desk can ignore some requests and then we will never load correctly.
		*/
    if (loadingAddresses.length > 0) {
      const msg = udpPort.send({
        address: loadingAddresses.shift(),
      });
    }
  });

  /**
   * Handle OSC messages while loading
   * @param {Object} oscMsg - the OSC message received
   */
  function loadingMessages(oscMsg: any) {
    if (DEBUG) {
      console.debug("Loading OSC message arrived: ", oscMsg);
    }

    const msg = mapping.getMsg(oscMsg, auxChannels);
    if (!msg) {
      return;
    }

    //save the changes
    saveConfig(msg);

    const totalLoadedParams = getTotalLoadedParams();
    loadingProgress.update(totalLoadedParams);

    if (totalLoadedParams == totalParamsToLoad) {
      loadingProgress.stop();

      udpPort.off("message", loadingMessages);
      udpPort.on("message", loadedMessages);

      startServer();

      return;
    }

    //request the next value from the desk
    if (loadingAddresses.length > 0) {
      udpPort.send({
        address: loadingAddresses.shift(),
      });
    }
  }
  udpPort.on("message", loadingMessages);
  udpPort.open();

  /**
   * Handle OSC messages after everything has been loaded
   * @param {Object} oscMsg - the OSC message received
   * @param {??} timeTag - the time tag specified by the sender (may be undefined for non-bundle messages)
   * @param {??} info - an implementation-specific remote information object
   */
  function loadedMessages(oscMsg: any, timeTag: any, info: any) {
    if (DEBUG) {
      console.debug("OSC message arrived: ", oscMsg);
    }

    const msg = mapping.getMsg(oscMsg, auxChannels);

    if (!msg) {
      return;
    }

    saveConfig(msg);

    sendToConnections(msg);
  }

  /**
   * Get the total Loaded parameters
   */
  function getTotalLoadedParams() {
    let totalLoadedParams = 0;

    //check if values have loaded
    for (let value in values) {
      if (values[value].level != null) {
        totalLoadedParams++;
      }
      if (values[value].pan !== undefined && values[value].pan != null) {
        totalLoadedParams++;
      }
    }

    //check if channels have loaded
    for (let chan of channels) {
      if (chan.label != null) {
        totalLoadedParams++;
      }
    }

    //check if aux labels have loaded
    for (let aux of auxList) {
      if (aux.label != null) {
        totalLoadedParams++;
      }
    }

    return totalLoadedParams;
  }

  function getActiveConnections() {
    return connections.filter(
      (connection) => connection.socket.readyState <= 1,
    );
  }

  function getAuxLabelByChannel(auxChannel: number) {
    const aux = auxList.find((entry) => entry.channel === auxChannel);
    return aux?.label ?? null;
  }

  function getChannelLabelByNumber(channelNumber: number) {
    const channel = channels.find((entry) => entry.channel === channelNumber);
    return channel?.label ?? null;
  }

  function logClientChange(
    client: ClientConnection,
    entry: Omit<ClientLogEntry, "at">,
  ) {
    client.log.push({
      ...entry,
      at: Date.now(),
    });

    if (client.log.length > 500) {
      client.log.shift();
    }
  }

  function getClientLevels(auxChannel: number) {
    return channels.map((channel) => {
      const value = values["a" + auxChannel + "|c" + channel.channel];
      return {
        channel: channel.channel,
        label: channel.label,
        level: value?.level ?? null,
        pan: value?.pan ?? null,
      };
    });
  }

  function serializeClient(
    connection: ClientConnection,
    disconnectedAt: number | null = null,
  ): AdminClient {
    const aux = auxList.find((entry) => entry.channel === connection.aux);
    return {
      id: connection.id,
      address: connection.address,
      connectedAt: connection.connectedAt,
      lastActivity: connection.lastActivity,
      disconnectedAt,
      aux: connection.aux,
      auxLabel: aux?.label ?? null,
      auxColour: aux?.colour ?? null,
      personName: connection.personName,
      levels: connection.aux != null ? getClientLevels(connection.aux) : null,
      log: connection.log,
    };
  }

  function getChannelValuesForAux(auxChannel: number) {
    const channelValues: Record<number, OSCValue> = {};
    for (let value in values) {
      for (let channel of channels) {
        if (value == "a" + auxChannel + "|c" + channel.channel) {
          channelValues[channel.channel] = values[value];
        }
      }
    }
    return channelValues;
  }

  function resolvePersonAssignment(
    personId: string,
    roleHint?: string,
  ): { member: RotaMember; auxChannel: number | null } | null {
    const assignments = findMemberAssignments(rotaMembers, personId);
    if (assignments.length === 0) {
      return null;
    }

    const member =
      (roleHint
        ? assignments.find((entry) => entry.role === roleHint)
        : undefined) ?? assignments[0];

    return {
      member,
      auxChannel: findAuxChannelForRole(auxList, member.role),
    };
  }

  function getAdminClients() {
    return getActiveConnections().map((connection) =>
      serializeClient(connection),
    );
  }

  function getAdminDisconnectedClients() {
    return disconnectedClients;
  }

  function startWebAppServer() {
    // Create an Express-based Web Socket server that clients can connect to
    let app = express();

    app.use(express.json());

    app.get("/api/admin/status", async (_req, res) => {
      res.json({
        url: getWebAppUrl(),
        qr: await QRCode.toDataURL(getWebAppUrl()),
        connections: getActiveConnections().length,
        authEnabled: auth.enabled,
        clients: getAdminClients(),
        disconnectedClients: getAdminDisconnectedClients(),
        aux: auxList.map((x) => ({
          label: x.label,
          channel: x.channel,
          colour: x.colour,
          stereo: x.stereo,
        })),
        mixLevels: Object.fromEntries(
          auxList.map((aux) => [aux.channel, getClientLevels(aux.channel)]),
        ),
        channels: channels.map((x) => ({
          label: x.label,
          channel: x.channel,
        })),
      });
    });

    app.get("/qr", async (_req, res) => {
      const data = await QRCode.toDataURL(getWebAppUrl());
      res.send(`<img src="${data}" />`);
    });

    useAuthRoutes(app);

    //app.use(`/${SessionId}`, express.static(appResources));
    app.use(express.static(appResources));

    let server = http
      .createServer(app)
      .listen({ port: serverPort, host: glowAudioIp });

    return server;
  }

  function useAuthRoutes(app: Application) {
    app.post("/auth", (req, res) => {
      if (!auth.enabled) {
        return res.json({
          ok: true,
          access: { auxes: auxList.map((x) => x.channel) },
        });
      }

      const { username, password } = req.body || {};
      const user = auth.users.find(
        (entry) => entry.username === username && entry.password === password,
      );

      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      return res.json({
        ok: true,
        username: user.username,
        access: user.access,
      });
    });
  }

  function startWebSocketServer(server: http.Server) {
    const wss = new WebSocket.Server({
      server,
    });

    wss.on("connection", function (socket, req) {
      const client: ClientConnection = {
        id: nextClientId++,
        socket,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        aux: null,
        personId: null,
        personName: null,
        address: req.socket.remoteAddress ?? null,
        log: [],
      };
      connections.push(client);

      if (DEBUG) {
        console.debug("New Connection", client.id);
      }

      //send new connection the current config
      let info = JSON.stringify({
        config: {
          channels: channels,
          aux: auxList,
          rotaPeople,
        },
      });
      socket.send(info);

      const isAuxQuery = (msg: ClientMessage): msg is GetAuthQuery => {
        return (msg as GetAuthQuery)["aux?"] !== undefined;
      };

      const isIdentifyRequest = (
        msg: ClientMessage,
      ): msg is IdentifyRequest => {
        return (msg as IdentifyRequest).identify !== undefined;
      };

      const touchClient = (aux?: number | null) => {
        client.lastActivity = Date.now();
        if (aux != null) {
          client.aux = aux;
        }
      };

      socket.on("message", function message(data) {
        // yucky!
        let msg: ClientMessage = JSON.parse(data.toString());

        if (DEBUG) {
          console.debug("Message from client: ", msg);
        }

        if (isIdentifyRequest(msg)) {
          const assignment = resolvePersonAssignment(msg.identify, msg.role);
          if (!assignment) {
            this.send(
              JSON.stringify({
                identified: false,
                error: "Person not found on today's rota",
              }),
            );
            return;
          }

          client.personId = assignment.member.id;
          client.personName = assignment.member.name;

          if (assignment.auxChannel == null) {
            this.send(
              JSON.stringify({
                identified: false,
                error: `No AUX configured for role "${assignment.member.role}"`,
                person: {
                  id: assignment.member.id,
                  name: assignment.member.name,
                  role: assignment.member.role,
                },
              }),
            );
            return;
          }

          if (client.aux !== assignment.auxChannel) {
            logClientChange(client, {
              type: "aux",
              aux: assignment.auxChannel,
              auxLabel: getAuxLabelByChannel(assignment.auxChannel),
              value: assignment.auxChannel,
            });
          }
          touchClient(assignment.auxChannel);

          this.send(
            JSON.stringify({
              identified: true,
              aux: assignment.auxChannel,
              person: {
                id: assignment.member.id,
                name: assignment.member.name,
                role: assignment.member.role,
                img: assignment.member.img ?? null,
              },
              channels: getChannelValuesForAux(assignment.auxChannel),
            }),
          );
          return;
        }

        /*
				Respond to connection when a request was made for the current values for a AUX.
				*/
        if (isAuxQuery(msg)) {
          const newAux = msg["aux?"];
          if (client.aux !== newAux) {
            logClientChange(client, {
              type: "aux",
              aux: newAux,
              auxLabel: getAuxLabelByChannel(newAux),
              value: newAux,
            });
          }
          touchClient(newAux);

          this.send(
            JSON.stringify({
              "aux?": msg["aux?"],
              channels: getChannelValuesForAux(newAux),
            }),
          );

          return;
        }

        if ("aux" in msg) {
          touchClient(msg.aux);

          if (msg.level !== undefined) {
            const existing = values["a" + msg.aux + "|c" + msg.channel];
            logClientChange(client, {
              type: "level",
              aux: msg.aux,
              auxLabel: getAuxLabelByChannel(msg.aux),
              channel: msg.channel,
              channelLabel: getChannelLabelByNumber(msg.channel),
              value: msg.level,
              previousValue: existing?.level ?? null,
            });
          }

          if (msg.pan !== undefined) {
            const existing = values["a" + msg.aux + "|c" + msg.channel];
            logClientChange(client, {
              type: "pan",
              aux: msg.aux,
              auxLabel: getAuxLabelByChannel(msg.aux),
              channel: msg.channel,
              channelLabel: getChannelLabelByNumber(msg.channel),
              value: msg.pan,
              previousValue: existing?.pan ?? null,
            });
          }
        } else {
          touchClient();
        }

        //save the update
        saveConfig(msg);

        //tell desk to update
        udpPort.send(mapping.getOSC(msg));

        //tell other connections to update
        sendToConnections(msg, this);
      });

      socket.on("close", () => {
        const index = connections.findIndex(
          (connection) => connection.socket === socket,
        );
        if (index === -1) {
          return;
        }

        disconnectedClients.unshift(
          serializeClient(connections[index], Date.now()),
        );
        if (disconnectedClients.length > 50) {
          disconnectedClients.pop();
        }

        connections.splice(index, 1);
      });
    });

    wss.on("error", function (err) {
      console.debug("wss error", err);
    });
  }

  function hashString(str: string, seed = 0) {
    let h1 = 0xdeadbeef ^ seed,
      h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function getWebAppUrl() {
    return "http://" + glowAudioIp + ":" + serverPort + "/"; //+ SessionId;
  }

  function createSessionId(): string {
    const now = new Date();
    const str = now.toDateString() + "123";
    const hash = hashString(str);

    faker.seed(hash);

    return [
      faker.color.human(),
      faker.word.noun({
        length: {
          max: 5,
          min: 4,
        },
      }),
    ]
      .join("-")
      .toLowerCase()
      .replace(/\s/g, "");
  }

  function startServer() {
    const webappUrl = getWebAppUrl();
    let server = startWebAppServer();

    startWebSocketServer(server);

    console.log(
      `\n\nServer Ready.\nVisit ${webappUrl} in a web browser to access OSC Web Mixer.\nAdmin dashboard: ${webappUrl}admin.html\nPlease make sure the device you want to use is on the same network.`,
    );

    QRCodeTerminal.generate(webappUrl, { small: true });
  }

  /**
   * Send a message to current connections.
   *    This will remove any connections from the connections array if that have become invalid.
   * @param object msg - The OSC message to send
   * @param socket ignore - A socket connection to not send the message to.
   */
  function sendToConnections(msg: any, ignore: null | WebSocket = null) {
    connections = getActiveConnections();
    connections.forEach(function (connection) {
      if (connection.socket != ignore) {
        connection.socket.send(JSON.stringify(msg));
      }
    });
  }

  type SaveConfigRequest =
    | SetAuxRequest
    | { auxname: string; channel: number }
    | { name: string; channel: number };

  /**
   * Update current config with supplied message
   * @param object update - the update to apply
   */
  function saveConfig(update: SaveConfigRequest) {
    //update aux channel name
    if ("auxname" in update && update.auxname) {
      //only save aux info we care about
      if (auxChannels.indexOf(update.channel) == -1) {
        return;
      }

      for (let aux of auxList) {
        if (aux.channel == update.channel) {
          aux.label = update.auxname;
          return;
        }
      }
    }

    //only save channel info we care about
    if (supportedChannels.indexOf(update.channel) == -1) {
      return;
    }

    //update channel name
    if ("name" in update && update.name) {
      for (let channel of channels) {
        if (channel.channel == update.channel) {
          channel.label = update.name;
          return;
        }
      }
    }

    const valueKey = "a" + update.aux + "|c" + update.channel;

    //save the level for a channel
    if (update.level != undefined) {
      if (!values[valueKey]) {
        values[valueKey] = {};
      }

      values[valueKey].level = update.level;
    }

    //save the pan for a channel
    if (update.pan != undefined) {
      if (!values[valueKey] || values[valueKey].pan === undefined) {
        values[valueKey] = {};
      }

      values[valueKey].pan = update.pan;
    }
  }

  /*setTimeout(function(){

		loadingMessages({
			address: "/sd/Input_Channels/1/Aux_Send/1/send_level",
			args: [.5]
		});

		loadingMessages({
			address: "/sd/Input_Channels/1/Aux_Send/1/send_pan",
			args: [.5]
		});

		loadingMessages({
			address: "/sd/Input_Channels/1/Channel_Input/name",
			args: ["test"]
		});

		loadingMessages({
			address: "/sd/Aux_Outputs/1/Buss_Trim/name",
			args: ["test"]
		});

		loadedMessages({
			address: "/channel/1/send/70/level",
			args: [.15]
		});

		loadedMessages({
			address: "/channel/1/send/70/pan",
			args: [1]
		});

		loadedMessages({
			address: "/channel/1/name",
			args: ["test1"]
		});

		loadedMessages({
			address: "/channel/70/name",
			args: ["test2"]
		});


	}, 5000);*/
};

module.exports = { init };
