const Packet = require("./Packet.js");
const Converter = require("../Converter.js");

class Packet20NamedEntitySpawn extends Packet {
	constructor(EID = 0, entityName = "", x = 0.0, y = 0.0, z = 0.0, yaw = 0.0, pitch = 0.0, currentItem = 0) {
		super(0x14);

		this.EID = EID;
		this.entityName = entityName;
		this.absX = Converter.toAbsoluteInt(x);
		this.absY = Converter.toAbsoluteInt(y);
		this.absZ = Converter.toAbsoluteInt(z);
		this.packedYaw = 0;		// TODO: Add rotation.
		this.packedPitch = 0;
		this.currentItem = currentItem;
	}

	writePacket() {
		super.writePacket();

		this.writer.writeInt(this.EID);
		this.writer.writeString(this.entityName);
		this.writer.writeInt(this.absX);
		this.writer.writeInt(this.absY);
		this.writer.writeInt(this.absZ);
		this.writer.writeByte(this.packedYaw);
		this.writer.writeByte(this.packedPitch);
		this.writer.writeShort(this.currentItem);

		return this.toBuffer();
	}
}

module.exports = Packet20NamedEntitySpawn;