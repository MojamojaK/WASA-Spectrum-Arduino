// Tools > Flash Size の設定を間違えるとプログラムは正常に動きません
// 大量のエラーメッセージが吐き出される場合はこれが原因である可能性が高いです
// 正しい値を確認するには File > Examples > ESP8266 > CheckFlashConfig のスケッチを開いて書き込んでみて
// 現在、国内市場に出回っているものはほとんど 2MB となっております
// 2017年以前は 4MB が主流でしたので気をつけて下さい
// パソコン再起動時に設定がリセットされるので気をつけて

#include <SoftwareSerial.h>
#include <ESP8266WiFi.h>
#include <WebSocketsServer.h>
#include <ESP8266WebServer.h>
#include "FS.h"
#include "esp_comm.h"

#define DEBUG_PIN 12

#define ARD_COMM_RX 13
#define ARD_COMM_TX 14

//操舵用基板通信
SoftwareSerial ControlSerial(ARD_COMM_RX, ARD_COMM_TX); // RX | TX

// WiFi パラメータ
const char* ssid = "Spectrum";
const char* password = "123456789";

ESP8266WebServer server = ESP8266WebServer(80);
WebSocketsServer webSocket = WebSocketsServer(81);

uint8_t socket_packet[128];
uint8_t rx_packet[128];
uint8_t tx_packet[128];
uint8_t rx_len;

boolean transmitting = false;

//操舵基板用通信パケットについて
// 0x00: 0x8F ヘッダー上
// 0x01: 0xF8 ヘッダー下
// 0x02: ---- デバイスID          (無いときは0xFFにする)
// 0x03: ---- コマンド            (以下に詳細)
// 0x04: ---- データ長            (データ部分のみ)
// 0x05: ---- データ              (コマンド実行用のパラメータ)
// LAST: ---- 最後はチェックサム   (ヘッダーを除くチェックサム)

// 操舵基板用コマンド詳細
// ここで述べる操舵基板用コマンドは、操舵用基板が受信するコマンドを指す
// 操舵基板用通信パケットの 0x03 番アドレスに入れれば良い
// 0x00:  ログ用           パラメータの情報がそのまま操舵基盤によってDEBUG_SERIAL.print()される
// 0x01:  設定用           最大最小ニュートラル角の設定用
//        アドレス   データ             意味
//        0x05      0x01              ラダー       最小
//                  0x02              ラダー       ニュートラル
//                  0x03              ラダー       最大
//                  0x05              エレベータ   最小
//                  0x06              エレベータ   ニュートラル
//                  0x07              エレベータ   最大
//        0x06      (-1500~1500)      角度              下位バイト
//        0x07      (-1500~1500)      角度              上位バイト
// 0x02:  データリクエスト用 操舵基板からデータを要請する
//        アドレス   データ             意味
//        0x05      0x00              初期データのリクエスト
// 0x03:  サーボリブート用
//        アドレス   データ             意味
//        0x05      (0x01~0x02)       サーボID
// 0x04:  サーボトルクセット用
//        アドレス   データ             意味
//        0x05      (0x01~0x02)       サーボID
//        0x06      (0~100)           サーボトルク 0~100%で
// 0x05:  サーボトルクモードセット
//        アドレス   データ             意味
//        0x05      (0x01~0x02)       サーボID
//        0x06      0x00              OFF
//                  0x01              ON
//                  0x02              BREAK MODE
// 0x06:  テストモード
//        アドレス   データ             意味
//        0x05      (0x01~0x02)       サーボID
//        0x06      0x00              OFF
//                  0x01              ON
// 0x07:  テストモード中のサーボ角の値設定
//        アドレス   データ             意味
//        0x05      (0x01~0x02)       サーボID
//        0x06      (-1500~1500)      角度              下位バイト
//        0x07      (-1500~1500)      角度              上位バイト
// 0x08:  試験動作(Sweep)の実行
//        アドレス   データ             意味
//        0x05      (0x01~0x02)       サーボID
//        0x06      (0x01~0xFF)       スピード
// 0xF0:  プロンプトに対するレスポンス
//        アドレス   データ             意味
//        0x05      (0~7)             コマンド名
//        0x06      (0x00 ~ 0x01)     false or true

// デバイス通信用パケットについて
// 0x00: 0x8D ヘッダー上
// 0x01: 0xD8 ヘッダー下
// 0x02: ---- デバイスID          (無いときは0xFFにする)
// 0x03: ---- コマンド
// 0x04: ---- データ長
// 0x05: ---- データ
// LAST: ---- チェックサム (ヘッダー除く)

// デバイス用コマンド詳細
// ここで述べるデバイス用コマンドは、スマートフォン端末などの外部デバイスが受信するコマンドを指す
// デバイス通信用パケットの 0x02 番アドレスに入れれば良い
// 0x00:  表示データ設定
// 0x01:  プロンプト用

void setup() {
  Serial.begin(9600);
  ControlSerial.begin(9600);

  pinMode(DEBUG_PIN, OUTPUT);
  digitalWrite(DEBUG_PIN, LOW);

  WiFi.setAutoReconnect(false);
  WiFi.disconnect();
  WiFi.softAP(ssid, password);

  send_log(String(F("IP Address:")) + IPtoString(WiFi.softAPIP()) + F("\n")); // 23

  // start webSocket server
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  SPIFFS.begin();
  server.onNotFound([](){
    if(!handleFileRead(server.uri()))
      server.send(404, F("text/plain"), F("404:FileNotFound"));
  });
  
  server.begin();
}

void loop() {
  webSocket.loop();
  server.handleClient();
  if (ControlSerial.available() && CommandReceive()) {
    //send_log("received from controller");
    if (rx_packet[2] == 0xFA) webSocket.broadcastBIN(rx_packet, rx_len);
    else webSocket.sendBIN(rx_packet[2], rx_packet, rx_len);
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len) {
  switch (type) {
    case WStype_DISCONNECTED: {
        send_log(F("Disconnected!\n"), num);
      }
      break;
    case WStype_CONNECTED: {
        IPAddress t_ip = webSocket.remoteIP(num);
        send_log(String( F("[")) + String(num) + F("] Connected from ") + IPtoString(t_ip) + F(" url: ") + String((char*)payload) + F("\n"));
      }
      break;
    case WStype_BIN: {
        digitalWrite(DEBUG_PIN, HIGH);
        if (payload[0] != 0x8F || payload[1] != 0xF8) return;
        if (checksum(payload, len - 1) != payload[len - 1]) return;
        payload[2] = num;
        payload[len - 1] = checksum(payload, len - 1);
        ControlSerial.write(payload, len);
        digitalWrite(DEBUG_PIN, LOW);
      }
      break;
  }
}

String IPtoString(IPAddress ip) {
  return String(ip[0]) + F(".") + String(ip[1]) + F(".") + String(ip[2]) + F(".") + String(ip[3]);
}

void request_data(uint8_t num, uint8_t type) {
  tx_packet[0] = 0x8F;    //ヘッダー
  tx_packet[1] = 0xF8;    //ヘッダー
  tx_packet[2] = num;     //デバイスID
  tx_packet[3] = 0x02;    //コマンド      0x02は初期値の取得
  tx_packet[4] = 0x01;    //コマンド長
  tx_packet[5] = type;    //コマンドパラメータ
  tx_packet[6] = checksum(tx_packet, 6);
  ControlSerial.write(tx_packet, 7);
}

void send_log(String str, uint8_t id) {
  tx_packet[0] = 0x8F;
  tx_packet[1] = 0xF8;
  tx_packet[2] = id;
  tx_packet[3] = 0x00;
  tx_packet[4] = (uint8_t)str.length();
  str.toCharArray((char*)tx_packet + 5, 122);
  tx_packet[tx_packet[4] + 5] = checksum(tx_packet, tx_packet[4] + 5);
  ControlSerial.write(tx_packet, tx_packet[4] + 6);
  ControlSerial.flush();
  delay(15);
}

void send_log(String str) {
  send_log(str, 0xFF);
}

uint8_t checksum(uint8_t* packet, uint8_t packet_size) {
  uint8_t sum = packet[2];
  for (uint8_t i = 3; i < packet_size; i++) sum ^= packet[i];
  return sum;
}

// 操舵基板からコマンドの受信
boolean CommandReceive() {
  uint32_t wait_time = millis();
  while (!ControlSerial.available()) {
    if ((uint32_t)(millis() - wait_time) > 12) return false;
  }
  wait_time = millis();
  while ((rx_packet[0] = ControlSerial.read()) != 0x8D) {
    if ((uint32_t)(millis() - wait_time) > 6) return false;
  }
  delayMicroseconds(1010);
  for (uint8_t i = 1, wait_time = millis(); i < 5; i++) {
    while (!ControlSerial.available()) if ((uint32_t)(millis() - wait_time) > 3) return false;
    rx_packet[i] = ControlSerial.read();
    wait_time = millis();
    delayMicroseconds(1010);
  }
  if ((uint8_t)rx_packet[4] > 122) return false;
  for (uint8_t i = 5, wait_time = millis(); i < 6 + rx_packet[4]; i++) {
    while (!ControlSerial.available()) if ((uint32_t)(millis() - wait_time) > 3) return false;
    rx_packet[i] = ControlSerial.read();
    wait_time = millis();
    delayMicroseconds(1010);
  }
  if (rx_packet[0] == 0x8D && rx_packet[1] == 0xD8 && rx_packet[rx_packet[4] + 5] == checksum(rx_packet, rx_packet[4] + 5)) {
    rx_len = rx_packet[4] + 6;
    return true;
  }
  return false;
}

String getContentType(String filename){
  if(server.hasArg(F("download"))) return F("application/octet-stream");
  else if(filename.endsWith(F(".htm"))) return F("text/html");
  else if(filename.endsWith(F(".html"))) return F("text/html");
  else if(filename.endsWith(F(".css"))) return F("text/css");
  else if(filename.endsWith(F(".js"))) return F("application/javascript");
  else if(filename.endsWith(F(".png"))) return F("image/png");
  else if(filename.endsWith(F(".gif"))) return F("image/gif");
  else if(filename.endsWith(F(".jpg"))) return F("image/jpeg");
  else if(filename.endsWith(F(".ico"))) return F("image/x-icon");
  else if(filename.endsWith(F(".xml"))) return F("text/xml");
  else if(filename.endsWith(F(".pdf"))) return F("application/x-pdf");
  else if(filename.endsWith(F(".zip"))) return F("application/x-zip");
  else if(filename.endsWith(F(".gz"))) return F("application/x-gzip");
  return F("text/plain");
}

bool handleFileRead(String path){
  Serial.print(F("handleFileRead: "));
  Serial.println(path);
  send_log(String(F("File Handle: ")) + path);
  if(path.endsWith("/")) path += F("index.html");
  String contentType = getContentType(path);
  String pathWithGz = path + F(".gz");
  if(SPIFFS.exists(pathWithGz) || SPIFFS.exists(path)){
    if(SPIFFS.exists(pathWithGz)) path += F(".gz");
    File file = SPIFFS.open(path, "r");
    size_t sent = server.streamFile(file, contentType);
    file.close();
    return true;
  }
  return false;
}
