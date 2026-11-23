import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const OPEN = 1, CLOSED = 3, MAX_FRAME = 1_048_576;
function frame(opcode, data = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let header;
  if (body.length < 126) { header = Buffer.from([0x80 | opcode, body.length]); }
  else if (body.length <= 0xffff) { header = Buffer.alloc(4); header[0]=0x80|opcode; header[1]=126; header.writeUInt16BE(body.length,2); }
  else { header=Buffer.alloc(10); header[0]=0x80|opcode; header[1]=127; header.writeBigUInt64BE(BigInt(body.length),2); }
  return Buffer.concat([header,body]);
}
class Peer extends EventEmitter {
  constructor(socket) { super(); this.socket=socket; this.readyState=OPEN; this.buffer=Buffer.alloc(0); socket.setNoDelay(true); socket.on('data',chunk=>this.read(chunk)); socket.on('error',()=>this.finish()); socket.on('close',()=>this.finish()); }
  send(value) { if(this.readyState===OPEN)this.socket.write(frame(1,String(value))); }
  close() { if(this.readyState!==OPEN)return; this.socket.write(frame(8)); this.socket.end(); this.finish(); }
  finish() { if(this.readyState===CLOSED)return; this.readyState=CLOSED; this.emit('close'); }
  read(chunk) {
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length>=2){const a=this.buffer[0],b=this.buffer[1],opcode=a&15,masked=!!(b&128);let len=b&127,offset=2;if(len===126){if(this.buffer.length<4)return;len=this.buffer.readUInt16BE(2);offset=4}else if(len===127){if(this.buffer.length<10)return;const big=this.buffer.readBigUInt64BE(2);if(big>BigInt(MAX_FRAME)){this.close();return}len=Number(big);offset=10}if(len>MAX_FRAME){this.close();return}const maskBytes=masked?4:0;if(this.buffer.length<offset+maskBytes+len)return;let payload=this.buffer.subarray(offset+maskBytes,offset+maskBytes+len);if(masked){payload=Buffer.from(payload);const mask=this.buffer.subarray(offset,offset+4);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4]}this.buffer=this.buffer.subarray(offset+maskBytes+len);if(opcode===8){this.socket.write(frame(8));this.socket.end();this.finish();return}if(opcode===9){this.socket.write(frame(10,payload));continue}if(opcode===1)this.emit('message',payload);}
  }
}
export class WebSocketServer extends EventEmitter {
  constructor({host='0.0.0.0',port}) { super();this.peers=new Set();this.http=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end('Business room server is ready.\n')});this.http.on('upgrade',(req,socket)=>{const key=req.headers['sec-websocket-key'];if(!key||req.headers.upgrade?.toLowerCase()!=='websocket'){socket.destroy();return}const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);const peer=new Peer(socket);this.peers.add(peer);peer.once('close',()=>this.peers.delete(peer));this.emit('connection',peer,req)});this.http.listen(port,host); }
  close(callback) { for(const peer of this.peers)peer.close();this.http.close(callback); }
}
