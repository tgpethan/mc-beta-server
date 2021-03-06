/*
	==============- server.js -=============
	  Created by Holly (tgpethan) (c) 2021
	  Licenced under MIT
	========================================
*/

const bufferStuff = require("./bufferStuff.js");
const ChunkManager = require("./chunkManager.js");
const User = require("./user.js");
const EntityPlayer = require("./Entities/EntityPlayer.js");
const PacketMappingTable = require("./PacketMappingTable.js");
const NamedPackets = require("./NamedPackets.js");
const Converter = require("./Converter.js");
const Block = require("./Blocks/Block.js");

const Socket = require("net").Socket;

let idPool = 1;
global.fromIDPool = function() {
	const oldVal = idPool;
	idPool++;
	return oldVal;
}

let netUsers = {},
	netUserKeys = Object.keys(netUsers);

global.getUserByKey = function(key) {
	return netUsers[key];
}

global.sendToAllPlayers = function(buffer = Buffer.alloc(0)) {
	for (let key of netUserKeys) {
		const user = netUsers[key];
		user.socket.write(buffer);
	}
}

global.sendToAllPlayersButSelf = function(id, buffer = Buffer.alloc(0)) {
	for (let key of netUserKeys) {
		if (key == id) continue;
		const user = netUsers[key];
		user.socket.write(buffer);
	}
}

function addUser(socket) {
	let user = new User(global.fromIDPool(), socket);
	user.entityRef = new EntityPlayer(user, 8.5, 65.5, 8.5);
	netUsers[user.id] = user;
	netUserKeys = Object.keys(netUsers);

	return user;
}

function removeUser(id) {
	delete netUsers[id];
	netUserKeys = Object.keys(netUsers);
}

let config = {};

let entities = {};
let entityKeys = {};

global.chunkManager = new ChunkManager();
global.generatingChunks = false;

let tickInterval, tickCounter = BigInt(0), worldTime = 0;
let tickRate = BigInt(20);

module.exports.init = function(config) {
	config = config;
    console.log(`Up! Running at 0.0.0.0:${config.port}`);

	tickInterval = setInterval(() => {
		// Runs every sec
		if (tickCounter % tickRate == 0) {
			for (let key of netUserKeys) {
				const user = netUsers[key];
				user.socket.write(new PacketMappingTable[NamedPackets.KeepAlive]().writePacket());
				if (user.loginFinished) user.socket.write(new PacketMappingTable[NamedPackets.TimeUpdate](BigInt(worldTime)).writePacket());
			}
		}
		// Do chunk updates
		// Don't update if chunk is generating
		if (global.chunkManager.queuedBlockUpdates.getLength() > 0) {
			let itemsToRemove = [];
			// Do a max of 128 block updates per tick
			for (let i = 0; i < Math.min(global.chunkManager.queuedBlockUpdates.getLength(), 128); i++) {
				const chunkUpdateKey = global.chunkManager.queuedBlockUpdates.itemKeys[i];
				const chunkUpdate = global.chunkManager.queuedBlockUpdates.items[chunkUpdateKey];
				
				// TODO: Remove this once infinite terrain is in :)
				if (chunkUpdate[0] < -3 || chunkUpdate[0] > 3 || chunkUpdate[1] < -3 || chunkUpdate[1] > 3) {
					itemsToRemove.push(chunkUpdateKey, false);
					continue;
				}

				// If the chunk just plain doesn't exist (yet) skip this one
				if (global.chunkManager.chunks[chunkUpdate[0]] == null) continue;
				if (global.chunkManager.chunks[chunkUpdate[0]][chunkUpdate[1]] == null) continue;

				global.chunkManager.chunks[chunkUpdate[0]][chunkUpdate[1]][chunkUpdate[2]][chunkUpdate[3]][chunkUpdate[4]][0] = chunkUpdate[5];
				global.chunkManager.chunks[chunkUpdate[0]][chunkUpdate[1]][chunkUpdate[2]][chunkUpdate[3]][chunkUpdate[4]][1] = chunkUpdate[6];

				const packet = new PacketMappingTable[NamedPackets.BlockChange](chunkUpdate[3] + (chunkUpdate[0] << 4), chunkUpdate[2], chunkUpdate[4] + (chunkUpdate[1] << 4), chunkUpdate[5], chunkUpdate[6]).writePacket();
				for (let userKey of netUserKeys) {
					const user = netUsers[userKey];
					if (user.loginFinished) user.socket.write(packet);
				}

				itemsToRemove.push(chunkUpdateKey);
			}

			for (let item of itemsToRemove) {
				global.chunkManager.queuedBlockUpdates.remove(item, false);
			}

			global.chunkManager.queuedBlockUpdates.regenerateIterableArray();
		}

		// Entity update!
		for (let key of netUserKeys) {
			const user = netUsers[key];
			
			if (user.loginFinished) user.entityRef.onTick();
		}

		// Send queued chunks to users
		for (let key of netUserKeys) {
			const user = netUsers[key];

			if (user.loginFinished) {
				let itemsToRemove = [];
				for (let i = 0; i < Math.min(user.chunksToSend.getLength(), 128); i++) {
					const chunkKey = user.chunksToSend.itemKeys[i];
					itemsToRemove.push(chunkKey);
					user.socket.write(user.chunksToSend.items[chunkKey]);
				}

				for (let item of itemsToRemove) {
					user.chunksToSend.remove(item, false);
				}

				user.chunksToSend.regenerateIterableArray();
			}
		}

		tickCounter++;
		worldTime++;
	}, 1000 / parseInt(tickRate.toString()));

	for (let x = -3; x < 4; x++) {
		for (let z = -3; z < 4; z++) {
			global.chunkManager.createChunk(x, z);
		}
	}
}

module.exports.connection = async function(socket = new Socket) {
	const thisUser = addUser(socket);

    socket.on('data', function(chunk) {
		const reader = new bufferStuff.Reader(chunk);

		const packetID = reader.readByte();

        switch(packetID) {
			case NamedPackets.Disconnect:
				removeUser(thisUser.id);
			break;

			case NamedPackets.KeepAlive:
				
			break;

			case NamedPackets.LoginRequest:
				socket.write(new PacketMappingTable[NamedPackets.LoginRequest](reader.readInt(), reader.readString(), global.chunkManager.seed, reader.readByte()).writePacket(thisUser.id));
				socket.write(new PacketMappingTable[NamedPackets.SpawnPosition]().writePacket());

				for (let x = -3; x < 4; x++) {
					for (let z = -3; z < 4; z++) {
						socket.write(new PacketMappingTable[NamedPackets.PreChunk](x, z, true).writePacket());
					}
				}

				// Place a layer of glass under the player so they don't fall n' die
				for (let x = 0; x < 16; x++) {
					for (let z = 0; z < 16; z++) {
						socket.write(new PacketMappingTable[NamedPackets.BlockChange](x, 64, z, Block.glass.blockID, 0).writePacket());
					}
				}

				socket.write(new PacketMappingTable[NamedPackets.Player](true).writePacket());

				const joinMessage = new PacketMappingTable[NamedPackets.ChatMessage](`\u00A7e${thisUser.username} has joined the game`).writePacket();
				for (let key of netUserKeys) {
					netUsers[key].socket.write(joinMessage);
				}

				socket.write(new PacketMappingTable[NamedPackets.SetSlot](0, 36, 3, 64, 0).writePacket());

				socket.write(new PacketMappingTable[NamedPackets.PlayerPositionAndLook](8.5, 65 + 1.6200000047683716, 65, 8.5, 0, 0, false).writePacket());

				thisUser.loginFinished = true;

				// Send chunks
				for (let x = -3; x < 4; x++) {
					for (let z = -3; z < 4; z++) {
						global.chunkManager.multiBlockChunk(x, z, thisUser);
					}
				}

				// Send this user to other online user
				global.sendToAllPlayersButSelf(thisUser.id, new PacketMappingTable[NamedPackets.NamedEntitySpawn](thisUser.id, thisUser.username, thisUser.entityRef.x, thisUser.entityRef.y, thisUser.entityRef.z, thisUser.entityRef.yaw, thisUser.entityRef.pitch, 0).writePacket());

				// send all online users to this user
				for (let key of netUserKeys) {
					if (key == thisUser.id) continue;
					const user = netUsers[key];

					socket.write(new PacketMappingTable[NamedPackets.NamedEntitySpawn](user.id, user.username, user.entityRef.x, user.entityRef.y, user.entityRef.z, user.entityRef.yaw, user.entityRef.pitch, 0).writePacket());
				}
			break;

			case NamedPackets.Handshake:
				thisUser.username = reader.readString();

				socket.write(new PacketMappingTable[NamedPackets.Handshake](thisUser.username).writePacket());
			break;

			case NamedPackets.ChatMessage:
				const message = reader.readString();
				// Hacky commands until I made a command system
				if (message.startsWith("/")) {
					const command = message.substring(1, message.length).split(" ");
					console.log(command);
					if (command[0] == "time") {
						if (command.length < 2) {
						} else if (command[1] == "set") {
							if (command.length < 3) {
							} else {
								switch (command[2]) {
									case "day":
										worldTime = (24000 * (worldTime / 24000));
									break;

									case "noon":
										worldTime = (24000 * (worldTime / 24000)) + 6000;
									break;

									case "sunset":
										worldTime = (24000 * (worldTime / 24000)) + 12000;
									break;

									case "midnight":
										worldTime = (24000 * (worldTime / 24000)) + 18000;
									break;
								}
							}
						}
					}
				} else {
					// Send player's message to all players
					const cachedPacket = new PacketMappingTable[NamedPackets.ChatMessage](`<${thisUser.username}> ${message}`).writePacket();
					for (let key of netUserKeys) {
						netUsers[key].socket.write(cachedPacket);
					}
				}
			break;

			case NamedPackets.PlayerLook:
				thisUser.entityRef.yaw = reader.readFloat() % 360 % -360;
				thisUser.entityRef.pitch = reader.readFloat() % 360 % -360;
			break;

			case NamedPackets.PlayerPosition:
				thisUser.entityRef.x = reader.readDouble();
				thisUser.entityRef.y = reader.readDouble();
				reader.readDouble(); // stance
				thisUser.entityRef.z = reader.readDouble();
			break;

			case NamedPackets.PlayerPositionAndLook:
				thisUser.entityRef.x = reader.readDouble();
				thisUser.entityRef.y = reader.readDouble();
				reader.readDouble(); // stance
				thisUser.entityRef.z = reader.readDouble();
				thisUser.entityRef.yaw = reader.readFloat() % 360 % -360;
				thisUser.entityRef.pitch = reader.readFloat() % 360 % -360;
			break;

			case NamedPackets.Animation:
				const EID = reader.readInt();
				const cachedPacket = new PacketMappingTable[NamedPackets.Animation](thisUser.id, reader.readByte()).writePacket();
				for (let key of netUserKeys) {
					if (netUsers[key].id !== thisUser.id) netUsers[key].socket.write(cachedPacket);
				}
			break;

			case NamedPackets.PlayerDigging:
				const status = reader.readByte();

				if (status == 2) {
					const x = reader.readInt();
					const y = reader.readByte();
					const z = reader.readInt();

					global.chunkManager.setBlock(x, y, z, 0);
				}
			break;

			case NamedPackets.PlayerBlockPlacement:
				const x = reader.readInt();
				const y = reader.readByte();
				const z = reader.readInt();
				let xOff = 0, yOff = 0, zOff = 0;
				switch (reader.readByte()) { // direction
					case 0: yOff = -1; break;
					case 1: yOff = 1; break;
					case 2: zOff = -1; break;
					case 3: zOff = 1; break;
					case 4: xOff = -1; break;
					case 5: xOff = 1; break;
				}
				const block = reader.readShort();

				global.chunkManager.setBlock(x + xOff, y + yOff, z + zOff, block);
			break;

			case NamedPackets.Player:
				
			break;

			default:
				console.log(toHexValue(packetID));
			break;
		}
	});

	socket.on('end', function() {
        console.log("Connection closed");
		removeUser(thisUser.id);
	});

	socket.on('error', function(err) {
        console.log("Connection error!");
		removeUser(thisUser.id);
	});
}

function toHexValue(val = 0x00) {
	if (val < 16) return `0x0${val.toString(16).toUpperCase()}`;
	else return `0x${val.toString(16).toUpperCase()}`;
}