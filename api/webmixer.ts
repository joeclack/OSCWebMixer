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
import { Fetcher } from "./planningCenter";
import prompts from "prompts";
import Jsona from "jsona";
import { faker } from "@faker-js/faker";

type AuxConfig = {
  label: string | null;
  channel: number;
  stereo: boolean;
  colour: string;
  extraPlanningCenterNames?: string[];
};

type GetAuthQuery = {
  "aux?": number;
};
type SetAuxRequest = {
  aux: number;
  channel: number;
  level: number;
};
type ClientMessage = GetAuthQuery | SetAuxRequest;

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
  fetcher: Fetcher
) => {
  let appResources = path.join(__dirname, "..", "web");

  const SKIP = process.argv.indexOf("skip") !== -1;
  const DEBUG = process.argv.indexOf("debug") !== -1;

  let offlineMode = true; //changed to true until fix the api issue

  const SessionId = createSessionId();

  // <-- Comment start to remove PC
  // let plans = [];
  // try {
  //   plans = await fetcher.getAllPlans();
  // } catch {
  //   const ans = await prompts({
  //     type: "confirm",
  //     name: "offline",
  //     message: "Planning center fetch failed. Continue in offline mode?",
  //   });

  //   offlineMode = Boolean(ans.offline);
  // }

  // const chosenPlan = await prompts([
  //   {
  //     type: "select",
  //     name: "plan",
  //     message: "Choose a plan",
  //     choices: plans.map((x) => {
  //       const date = new Date(x.sort_date);
  //       return {
  //         title:
  //           `${x.service_type?.name.trim()} - ${date.toDateString()} ${date.toLocaleTimeString()}` ||
  //           "No Name",
  //         // description: JSON.stringify(new Jsona().serialize({ stuff: x }).data),
  //         value: { serviceType: x.service_type.id, plan: x.id },
  //       };
  //     }),
  //   },
  // ]);
  // --> Comment end to remove PC
  let teamMembers = [];

  if (!offlineMode) {
    teamMembers = (await fetcher.getTeamMembers(
      chosenPlan.plan.serviceType,
      chosenPlan.plan.plan
    )) as any[];
  }
  const teamMemberFiltered = (teamMembers as any[]).map((x: any) => ({
    name: x.name as string,
    id: x.id as string,
    role: x.team_position_name as string,
    img: x.photo_thumbnail as string,
  }));

  const found = new Set<string>();
  const auxList = auxs.map((x) => {
    const user = teamMemberFiltered.find((y) => {
      return (
        !found.has(y.id) &&
        (y.role === x.label ||
          x.extraPlanningCenterNames?.some((n) => n === y.role))
      );
    });

    if (user) found.add(user.id);

    return { ...x, user: user || null };
  });

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
  let connections: WebSocket[] = [];

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
  let glowAudioIp = ipAddresses.find((x) => x.startsWith("192.168.2"));
  if (SKIP) glowAudioIp = ipAddresses[0];

  //if (!glowAudioIp) throw new Error("NO IP FOUND FOR GLOW AUDIO");
  // if (!glowAudioIp.endsWith("7"))
  //  console.info(
  //    "GLOW AUDIO IP DOES NOT END WITH 7 - DOES IT MATCH THE CONSOLE"
  //  );

  if (!offlineMode) {
    const result = await fetcher.setPlanNote(
      `EARS MIXER URL: \n\n ${getWebAppUrl()}`,
      chosenPlan.plan.plan,
      chosenPlan.plan.serviceType
    );
  }

  /*
	Progress bar to load desk values
	*/
  const loadingProgress = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic
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
    supportedChannels
  );

  udpPort.on("ready", function () {
    console.log("Loading Desk Values...");

    loadingProgress.start(totalParamsToLoad, 0);

    if (SKIP) {
      loadingProgress.update(totalParamsToLoad);
      loadingProgress.stop();

      udpPort.off("message", loadingMessages);
      udpPort.on("message", loadedMessages);

      startServer();
      return;
    }

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

  function startWebAppServer() {
    // Create an Express-based Web Socket server that clients can connect to
    let app = express();

    // console.log(auth);
    // if (auth.enabled) {
    //   useAuthRoutes(app, auth.users);
    // }

    app.get("/qr", async () => {
      const data = await QRCode.toDataURL(getWebAppUrl());
      return `<img src="${data}" />`;
    });

    let server = http
      .createServer(app)
      .listen({ port: serverPort, host: glowAudioIp });

    //app.use(`/${SessionId}`, express.static(appResources));
    app.use(express.static(appResources));

    return server;
  }

  function useAuthRoutes(app: Application) {
    app.post("/auth", (req, res) => {
      console.log(req.body);
      return res.status(200).send("OK");
    });
  }

  function startWebSocketServer(server: http.Server) {
    const wss = new WebSocket.Server({
      server,
    });

    wss.on("connection", function (socket) {
      connections.push(socket);

      if (DEBUG) {
        console.debug("New Connection");
      }

      //send new connection the current config
      let info = JSON.stringify({
        config: {
          channels: channels,
          aux: auxList,
        },
      });
      socket.send(info);

      const isAuxQuery = (msg: ClientMessage): msg is GetAuthQuery => {
        return (msg as GetAuthQuery)["aux?"] !== undefined;
      };

      socket.on("message", function message(data) {
        // yucky!
        let msg: ClientMessage = JSON.parse(data.toString());

        if (DEBUG) {
          console.debug("Message from client: ", msg);
        }

        /*
				Respond to connection when a request was made for the current values for a AUX.
				*/
        if (isAuxQuery(msg)) {
          let channelValues: Record<number, OSCValue> = {};
          for (let value in values) {
            for (let channel of channels) {
              if (value == "a" + msg["aux?"] + "|c" + channel.channel) {
                channelValues[channel.channel] = values[value];
              }
            }
          }

          this.send(
            JSON.stringify({
              "aux?": msg["aux?"],
              channels: channelValues,
            })
          );

          return;
        }

        //save the update
        saveConfig(msg);

        //tell desk to update
        udpPort.send(mapping.getOSC(msg));

        //tell other connections to update
        sendToConnections(msg, this);
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
      `\n\nServer Ready.\nVisit ${webappUrl} in a web browser to access OSC Web Mixer.\nPlease make sure the device you want to use is on the same network.`
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
    const validConnections: WebSocket[] = [];
    connections.forEach(function (connection) {
      /**
       * CONNECTING = 0
       * OPEN = 1
       */
      if (connection.readyState <= 1) {
        validConnections.push(connection);
        if (connection != ignore) {
          connection.send(JSON.stringify(msg));
        }
      }
    });
    connections = validConnections;
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
