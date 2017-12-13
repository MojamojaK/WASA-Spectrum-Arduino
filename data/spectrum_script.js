var servo_alias = ['', 'RUDDER', 'ELEVATOR'];
var torque_modes_alias = ['OFF', 'ON', 'BREAK'];
var value_types_alias = ['MIN', 'NEU', 'MAX'];
var test_mode = [-1,-1];
var torque_mode = [-1, -1];
var selection = [1,1];
var initial_load = false;
var d = new Date();

window.onload = function(){
	var lastTouchEnd = 0;
	var lastTouch = d.getTime();
	document.addEventListener('touchstart', function (e) {
  		var t2 = d.getTime();
  		var t1 = lastTouch;
  		var dt = t2 - t1;
  		var fingers = e.touches.length;
  		lastTouch = t2;
  		if (!dt || dt > 500 || fingers > 1) return; // not double-tap
  		e.preventDefault();
  		e.target.click();
	}, false);
};

var connection = new WebSocket('ws://'+location.hostname+':81/',['arduino']);

connection.onerror = function (error) {
	document.getElementById('rud').innerHTML = "DISCONNECTED";
	document.getElementById('ele').innerHTML = "DISCONNECTED";
	console.log('WebSocket Error ', error);
};

connection.onopen = function () {
	console.log('websocket opened');
	connection.onclose = function () {alert('WebSocket Connection Closed. Retry Connection.');};
	connection.binaryType = "arraybuffer";
	connection.onmessage = function (message) {
		function socketRespond(buf, value){
			var bA = new Uint8Array(8);
			bA[0] = 0x8F;
			bA[1] = 0xF8;
			bA[2] = buf[2];
			bA[3] = 0xF0;
			bA[4] = 0x02;
			bA[5] = buf[5];
			bA[6] = value & 0x000000FF;
			bA[7] = checksum(bA, 7);
			connection.send(bA.buffer);
		};
	    console.log("received message");
	    console.log(message.data);
		var buf = new Uint8Array(message.data);
		var len = buf.byteLength;
		var log = 'Got';
		for (var i = 0; i < len; i++)log += ' ' + buf[i].toString(16);
		console.log(log);
		if (buf[0] == 0x8D && buf[1] == 0xD8){
			if (buf[len-1] == checksum(buf, len-1)){
				if (buf[3] == 0x00){	/*表示*/
					var i = 0, j;
					while (i < buf[4]){
						j = i + 5;
						if ((0x01 <= buf[j] && buf[j] <= 0x03) || (0x05 <= buf[j] && buf[j] <= 0x07)){
							var val = ((buf[j+1] & 0x000000FF) | ((buf[j+2] & 0x000000FF) << 8));
							if (val & 0x8000) val = -(0x10000 - val);
							document.getElementById('set' + buf[j].toString()).innerHTML = val.toString();
							console.log("set: set"+ buf[j].toString() + " to " + val.toString());
							i+=3;
						}
						else if (0x08 <= buf[j] && buf[j] <= 0x09){
							document.getElementById('tsm' + (buf[j]-7).toString() + buf[j+1].toString()).style.backgroundColor = "red";
							document.getElementById('tsm' + (buf[j]-7).toString() + ((buf[j+1]+1)%2).toString()).style.backgroundColor = "white";
							test_mode[buf[j]-8]=buf[j+1];
							console.log("set: tsm" + (buf[j]-7).toString() + " to " + buf[j+1]);
							i+=2;
						}
						else if (0x0A <= buf[j] && buf[j] <= 0x0B){
							var s_id = 'tqm' + (buf[j]-9).toString();
							document.getElementById(s_id + buf[j+1].toString()).style.backgroundColor = "red";
							document.getElementById(s_id + ((buf[j+1]+1)%3).toString()).style.backgroundColor = "white";
							document.getElementById(s_id + ((buf[j+1]+2)%3).toString()).style.backgroundColor = "white";
							torque_mode[buf[j]-10]=buf[j+1];
							console.log("set: " + s_id + " to " + buf[j+1].toString());
							i+=2;
						}
						else if (0x0C <= buf[j] && buf[j] <= 0x0D){
							var s_id = 'swp' + (buf[j]-0x0B).toString();
							var color = ["white", "red"];
							document.getElementById(s_id + (buf[j+2]+1).toString()).style.backgroundColor = color[buf[j+1]];
							document.getElementById(s_id + (((buf[j+2]+1)%2)+1).toString()).style.backgroundColor = "white";
							console.log("set: " + s_id + " to " + (buf[j+1]+1).toString());
							i+=3;
						}
						else{
							i+=buf[4];
						}
					}
					if (!initial_load){
						setValueType(1, 1);
						setValueType(2, 1);
						initial_load = true;
					}
				}
				else if (buf[3] == 0x01){ /*確認*/
					if (buf[5] == 0x01){	/*サーボ角設定*/
						var valid = true;
						var cstr = 'Change [';
						var servo_id = (((buf[6] & 0x04) >> 2) & 0xFF) + 1;
						if (servo_id < 1 || 2 < servo_id) {cstr += 'ERROR '; valid = false;}
						else cstr += servo_alias[servo_id] + ' ';
						var tmp_str = (buf[6] & 0x03).toString();
						if 		(tmp_str == '1') cstr += 'MIN]';
						else if (tmp_str == '2') cstr += 'NEUTRAL]';
						else if (tmp_str == '3') cstr += 'MAX]';
						else{cstr += 'ERROR]'; valid = false;}
						var b_val = ((buf[7] & 0x000000FF) | ((buf[8] & 0x000000FF) << 8))
						if (b_val & 0x8000) b_val = -(0x10000 - b_val);
						var a_val = ((buf[9] & 0x000000FF) | ((buf[10] & 0x000000FF) << 8));
						if (a_val & 0x8000) a_val = -(0x10000 - a_val);
						cstr += ' '+b_val.toString() + ' ==> ' + a_val.toString();
						if (!(-1500 <= a_val && a_val <= 1500)) valid = false;
						if (valid && confirm(cstr + '?')){
							socketRespond(buf, 1);
							return;
						}
						socketRespond(buf, 0);
						alert('CANCEL ' + cstr);
					}
					else if (buf[5] == 0x03){ /*サーボ再起動*/
						var valid = true;
						var cstr = 'Reboot [';
						if (buf[6] < 1 || 2 < buf[6]) {cstr += 'ERROR'; valid = false;}
						else cstr += servo_alias[buf[6]];
						cstr += '] servo';
						if (valid && confirm(cstr + '?')){
							socketRespond(buf, 1);
							return;
						}
						socketRespond(buf, 0);
						alert('CANCEL ' + cstr);
					}
					else if (buf[5] == 0x04){ /*トルク%セット*/
						var valid = true;
						var cstr = 'Set [';
						if (buf[6] < 1 || 2 < buf[6]) {cstr += 'ERROR'; valid = false;}
						else cstr += servo_alias[buf[6]];
						cstr += ' TORQUE[%]] '+buf[7].toString()+'% ===> '+buf[8].toString()+'%';
						if (!(0 <= buf[8] && buf[8] <= 100)) valid = false;
						if (valid && confirm(cstr + '?')){
							socketRespond(buf, 1);
							return;
						}
						socketRespond(buf, 0);
						alert('CANCEL ' + cstr);
					}
					else if (buf[5] == 0x05){ /*トルクモードセット*/
						var valid = true;
						var cstr = 'Set [';
						if (buf[6] < 1 || 2 < buf[6]) {cstr += 'ERROR'; valid = false;}
						else cstr += servo_alias[buf[6]];
						var m_names = ['OFF','ON','BREAK'];
						cstr += ' TORQUE MODE] ';
						if (buf[7]<3)cstr += m_names[buf[7]];
						else {cstr += 'ERROR'; valid=false;}
						cstr += ' ===> ';
						if (buf[8]<3)cstr += m_names[buf[8]];
						else {cstr += 'ERROR'; valid=false;}
						if (valid && confirm(cstr + '?')){
							socketRespond(buf, 1);
							return;
						}
						socketRespond(buf, 0);
						alert('CANCEL ' + cstr);
					}
					else if (buf[5] == 0x06){ /*テストモード*/
						var valid = true;
						var cstr = 'Turn [';
						if (buf[6] < 1 || 2 < buf[6]) {cstr += 'ERROR'; valid = false;}
						else cstr += servo_alias[buf[6]];
						var m_names = ['OFF','ON'];
						cstr += ' TEST MODE] ';
						if (buf[7]<2)cstr += m_names[buf[7]];
						else {cstr += 'ERROR'; valid=false;}
						cstr += ' ===> ';
						if (buf[8]<2)cstr += m_names[buf[8]];
						else {cstr += 'ERROR'; valid=false;}
						if (valid && confirm(cstr + '?')){
							socketRespond(buf, 1);
							return;
						}
						socketRespond(buf, 0);
						alert('CANCEL ' + cstr);
					}
					else if (buf[5] == 0x08){ /* 試験動作モード */
						var valid = true;
						var cstr = 'Execute [';
						if (buf[6] < 1 || 2 < buf[6]) {cstr += 'ERROR'; valid = false;}
						else cstr += servo_alias[buf[6]];
						cstr += '] ';
						var s_names = ['SLOW','FAST'];
						if (buf[7]>0 && buf[7]<3)cstr += s_names[buf[7]-1];
						else {cstr += 'ERROR'; valid=false;}
						cstr += ' SWEEP';
						if (valid && confirm(cstr + '?')){
							socketRespond(buf, 1);
							return;
						}
						socketRespond(buf, 0);
						alert('CANCEL ' + cstr);
					}
				}
			}
		}
	};
	socketRequest(1);
};

function setValueType(id, value){
	var try_object = document.getElementById('try'+id.toString());
	try_object.value = parseInt(document.getElementById('set'+(value+(id-1)*4).toString()).innerHTML);
	document.getElementById('ind'+id.toString()+value.toString()).style.backgroundColor = "red";
	var others = [1,2,3];
	others.splice(value-1, 1);
	for (var i = 0; i < others.length; i++) document.getElementById('ind'+id.toString()+others[i].toString()).style.backgroundColor = "white";
	selection[id-1]=value;
	console.log('selected ' + servo_alias[id] + ' ' + value_types_alias[selection[id-1]-1]);
	try_object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){try_object.style.backgroundColor = "White";}, 100);
}

function socketSetTestMode(id, state){
	var bA = new Uint8Array(8);
	bA[0] = 0x8F;
	bA[1] = 0xF8;
	bA[2] = 0xFE;
	bA[3] = 0x06;
	bA[4] = 2;
	bA[5] = id;
	bA[6] = state;
	bA[7] = checksum(bA, 7);
	connection.send(bA.buffer);
	var object = document.getElementById('tsm' + id.toString() + state.toString());
	var tmp_color = object.style.backgroundColor;
	object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){object.style.backgroundColor = tmp_color;}, 100);
}

function changeTryRange(id, diff){
	var try_object = document.getElementById('try' + id.toString());
	var ctr_object = document.getElementById('ctr' + id.toString() + diff.toString());
	var val = parseInt(try_object.value);
	try_object.value = val + diff;
	ctr_object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){ctr_object.style.backgroundColor = "White";}, 100);
	try_object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){try_object.style.backgroundColor = "White";}, 100);
}

function setValue(id){
	var val = parseInt(document.getElementById('try' + id.toString()).value);
	var object = document.getElementById('vst' + id.toString());
	object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){document.getElementById('vst' + id.toString()).style.backgroundColor = "White";}, 100);
	if (isNaN(val) || !(-1500 <= val && val <= 1500)){
		return;
	}
	if (test_mode[id-1] == 1){
		console.log('TESTING ' + servo_alias[id] + ' ' + value_types_alias[selection[id-1]-1] + ': ' + val.toString());
		socketUpdateServoValue(id, 0x07, val);
		
	}
	else if (test_mode[id-1] == 0) {
		console.log('REQUEST SETTING ' + servo_alias[id] + ' ' + value_types_alias[selection[id-1]-1] + '(' + (selection[id-1]+(id-1)*4).toString() + '): ' + val.toString());
		socketUpdateServoValue(selection[id-1]+(id-1)*4, 0x01, val);
	}
	object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){object.style.backgroundColor = "White";}, 100);
}

function socketUpdateServoValue(id, mode, val){
	var bA = new Uint8Array(9);
	bA[0] = 0x8F;
	bA[1] = 0xF8;
	bA[2] = 0xFE;
	bA[3] = mode;
	bA[4] = 3;
	bA[5] = id;
	bA[6] = val & 0x000000FF;
	bA[7] = ((val & 0x0000FF00) >> 8) & 0x000000FF;
	bA[8] = checksum(bA, 8);
	connection.send(bA.buffer);
	return;
	alert('Invalid Input');
}

function socketRebootServo(id){
	var bA = new Uint8Array(7);
	bA[0] = 0x8F;
	bA[1] = 0xF8;
	bA[2] = 0xFE;
	bA[3] = 0x03;
	bA[4] = 1;
	bA[5] = id;
	bA[6] = checksum(bA, 6);
	connection.send(bA.buffer);
	console.log('REQUEST REBOOT [' + servo_alias[id] + ']');
	var object = document.getElementById('rbt' + id.toString());
	object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){object.style.backgroundColor = "White";}, 100);
}
function socketSetTorqueMode(id, state){
	if (0 > state || 2 < state) return;
	var bA = new Uint8Array(8);
	bA[0] = 0x8F;
	bA[1] = 0xF8;
	bA[2] = 0xFE;
	bA[3] = 0x05;
	bA[4] = 2;
	bA[5] = id;
	bA[6] = state;
	bA[7] = checksum(bA, 7);
	connection.send(bA.buffer);
	console.log('REQUEST SET [' + servo_alias[id] + '] TORQUE MODE to ' + torque_modes_alias[state]);
	var object = document.getElementById('tqm' + id.toString() + state.toString())
	var tmp_color = object.style.backgroundColor;
	object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){object.style.backgroundColor = tmp_color;}, 100);
}

function socketDoSweep(id, speed){
	var bA = new Uint8Array(8);
	bA[0] = 0x8F;
	bA[1] = 0xF8;
	bA[2] = 0xFE;
	bA[3] = 0x08;
	bA[4] = 2;
	bA[5] = id;
	bA[6] = speed;
	bA[7] = checksum(bA, 7);
	connection.send(bA.buffer);
	console.log('REQUEST SET [' + servo_alias[id] + '] SWEEP SPEED to ' + speed.toString());
	var object = document.getElementById('swp' + id.toString() + speed.toString());
	var tmp_color = object.style.backgroundColor;
	object.style.backgroundColor = "#0ffff7";
	setTimeout(function(){object.style.backgroundColor = tmp_color;}, 100);
}

function socketRequest(type){
	var bA = new Uint8Array(7);
	bA[0] = 0x8F;
	bA[1] = 0xF8;
	bA[2] = 0xFE;
	bA[3] = 0x02;
	bA[4] = 0x01;
	bA[5] = type & 0x000000FF;
	bA[6] = checksum(bA, 6);
	connection.send(bA.buffer);
};

function checksum(bA, location){
	sum = bA[2];
	for (var i=3;i<location;i++)sum^=bA[i];
	return sum;
};