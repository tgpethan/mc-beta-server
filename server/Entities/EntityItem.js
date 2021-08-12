const Entity = require("./Entity.js");

class EntityItem extends Entity {
	constructor(itemID = 0x00, x = 0, y = 0, z = 0) {
		super(x, y, z);

		this.motionX = (Math.random() * 0.2 - 0.1);
        this.motionY = 0.2;
        this.motionZ = (Math.random() * 0.2 - 0.1);
	}
}