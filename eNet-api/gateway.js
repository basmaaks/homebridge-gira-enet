"use strict";

const CONNECTION_PORT = 9050;

const net = require('net');
const util = require('util');
const EventEmitter = require('events');

class NoLogger {
    debug() {}
    info() {}
    error() {}
};

function gateway(config, log) {
    this.idleTimeout = 0;
    this.host = config.host;
    this.name = config.name || config.host;
    this.id = config.mac || config.name;

    this.client = new net.Socket();
    this.connected = false;
    this.data = '';
    this.log = log || new NoLogger();

    this.recentChannels = [];

    this.client.on('close', function() {
    	this.log.debug("Gateway", this.name, "on close");
        this.connected = false;
        this.emit('gateway', null, null);
	if (this.recentChannels.length) {
    	    this.log.info("Gateway", this.name, "closed. Reconnecting in 10 seconds.");
            setTimeout(10000, function() {
    		this.log.debug("Gateway", this.name, "signIn");
                this.signIn(this.recentChannels);
            }.bind(this));
	}
    }.bind(this));

    this.client.on('error', function (err) {
    	this.log.error("Gateway", this.name, "on error", err);
        this.connected = false;
        this.emit('gateway', err, null);
	if (this.recentChannels.length) {
    	    this.log.info("Gateway", this.name, "will try to reconnect in 60 seconds.");
            setTimeout(60000, function() {
    		this.log.debug("Gateway", this.name, "signIn");
                this.signIn(this.recentChannels);
            }.bind(this));
	}
    }.bind(this));

    this.client.on('data', function(data) {
        this.data += data;
        var arr = this.data.split("\r\n\r\n");
        this.data = arr[arr.length-1];

        for (var i = 0; i < arr.length-1; ++i) {
            try{
                var json=JSON.parse(arr[i]);
                if (json && (json.CMD == "ITEM_UPDATE_IND") && Array.isArray(json.VALUES)) {
                    var acknowledgeMsg = []; 
		    json.VALUES.forEach(function(obj) {
                        if (obj.NUMBER){
			    	acknowledgeMsg.push({"NUMBER":obj.NUMBER.toString(),"STATE":obj.STATE.toString()});
				this.emit('UpdateAvailable',obj);
				var msg = `{"CMD":"ITEM_VALUE_RES","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}","VALUES":[{"NUMBER":${obj.NUMBER},"STATE":"${obj.STATE}"}]}\r\n\r\n`;
                            this.client.write(msg)
			}
                    }.bind(this));
		    if (acknowledgeMsg != []){
                        var msg = `{"CMD":"ITEM_VALUE_RES","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}","VALUES":${JSON.stringify(acknowledgeMsg)}\r\n\r\n`;
                    }
                }
                else {
                    this.emit('gateway', null, json);
                }
            }catch(e){
                this.emit('gateway', e, null);
            }
        }
    }.bind(this));
}

util.inherits(gateway, EventEmitter);


module.exports = function (config, log) {
    return new gateway(config, log);
}


gateway.prototype.connect = function() {
    if (this.connected) return;
    if (!this.host) return;
    this.connected = true;
    this.log.debug("Gateway", this.name, "connecting.");

    this.client.connect(CONNECTION_PORT, this.host, function() {
            this.client.setTimeout(this.idleTimeout, function() {
    		this.log.debug("Gateway", this.name, "idle timeout.");
                this.disconnect();
            }.bind(this))
        }.bind(this));
}

gateway.prototype.disconnect = function() {
    this.log.debug("Gateway", this.name, "disconnect.");
    this.client.end();
    this.connected = false;
}

gateway.prototype.send = function(data) {
    this.client.write(data);
}


gateway.prototype.getVersion = function(callback){
    var l;

    if (callback) l = new responseListener(this, "VERSION_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"CMD":"VERSION_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}"}\r\n\r\n`;
    this.client.write(msg);

}

gateway.prototype.getBlockList = function(callback){
    var l;

    if (callback) l = new responseListener(this, "BLOCK_LIST_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"CMD":"BLOCK_LIST_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}","LIST-RANGE":1}\r\n\r\n`;
    this.client.write(msg);

}

gateway.prototype.getChannelInfo = function(callback){
    var l;

    if (callback) l = new responseListener(this, "GET_CHANNEL_INFO_ALL_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"CMD":"GET_CHANNEL_INFO_ALL_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}"}\r\n\r\n`;
    this.client.write(msg);

}

gateway.prototype.getProjectList = function(callback){
    var l;

    if (callback) l = new responseListener(this, "PROJECT_LIST_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"CMD":"PROJECT_LIST_GET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}"}\r\n\r\n`;
    this.client.write(msg);
}

gateway.prototype.signOut = function(callback){
    var l;

    if (!this.recentChannels.length)
    {
        callback && callback(new Error('signOut: Not signed in.'));
        return;
    }

    if (callback) l = new responseListener(this, "ITEM_VALUE_SIGN_OUT_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"ITEMS":${JSON.stringify(this.recentChannels)},"CMD":"ITEM_VALUE_SIGN_OUT_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}"}\r\n\r\n`;
    this.client.write(msg);
    this.recentChannels = [];

}

gateway.prototype.signIn = function(channels, callback){
    var l;

    if (!Array.isArray(channels))
    {
        if (callback) callback(new Error('signIn needs a channels array.'));
        return;
    }
    this.recentChannels = channels;
    if (callback) l = new responseListener(this, "ITEM_VALUE_SIGN_IN_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"ITEMS":${JSON.stringify(channels)},"CMD":"ITEM_VALUE_SIGN_IN_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}"}\r\n\r\n`;
    this.client.write(msg);

}

gateway.prototype.setValue = function(channel, on, long, callback){
    var l;

    if (callback) l = new channelResponseListener(this, channel, "ITEM_VALUE_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"CMD":"ITEM_VALUE_SET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}","VALUES":[{"STATE":"${on ? "ON":"OFF"}"${long ? ",\"LONG_CLICK\":\"ON\"" : ""},"NUMBER":${channel}}]}\r\n\r\n`;

    this.client.write(msg);
}

gateway.prototype.setValueDim = function(channel, dimVal, callback){
    var l;

    if (callback) l = new channelResponseListener(this, channel, "ITEM_VALUE_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"CMD":"ITEM_VALUE_SET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}","VALUES":[{"STATE":"VALUE_DIMM","VALUE":${dimVal},"NUMBER":${channel}}]}\r\n\r\n`;

    this.client.write(msg);
}

gateway.prototype.setValueBlind = function(channel, blindVal, callback){
    var l;

    if (callback) l = new channelResponseListener(this, channel, "ITEM_VALUE_RES", callback);

    if (!this.connected) this.connect();

    var msg = `{"CMD":"ITEM_VALUE_SET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}","VALUES":[{"STATE":"VALUE_BLINDS","VALUE":${blindVal},"NUMBER":${channel}}]}\r\n\r\n`;

    this.client.write(msg);
}


function responseListener(gateway, response, callback) {
    this.gateway = gateway;

    this.cb = function(err, msg) {
        if (err)
        {
            gateway.removeListener('gateway', this.cb);
            callback(err);
        }
        else {
            if (!msg) {
                gateway.removeListener('gateway', this.cb);
                callback(new Error("Gateway disconnected."));
                return;
            }

            if (msg.CMD === response){
                gateway.removeListener('gateway', this.cb);
                callback(null, msg);
            }
        }
    }.bind(this);

    gateway.on('gateway', this.cb);
}

function channelResponseListener(gateway, channel, response, callback) {
    this.gateway = gateway;
    this.listening = true;

    this.cb = function(err, msg) {
        if (err)
        {
            gateway.removeListener('gateway', this.cb);
            callback(err);
        }
        else {
            if (!msg) {
                gateway.removeListener('gateway', this.cb);
                callback(new Error("Gateway disconnected."));
                return;
            }
            if ((msg.CMD === response) && Array.isArray(msg.VALUES)) {
                msg.VALUES.forEach(function(obj) {
                    if (obj.NUMBER === channel.toString()){
                        gateway.removeListener('gateway', this.cb);
                        callback(null, obj);
                    }
                }.bind(this));
            }
        }
    }.bind(this);

    gateway.on('gateway', this.cb);
}
