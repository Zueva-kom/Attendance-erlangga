#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>

// ===================== Definisi Pin =====================
#define SS_PIN    D4
#define RST_PIN   D3   // Pin Reset RFID di D3
#define BUZZ_PIN  D0   // Pin Buzzer aman di D0 (Bekas Ultrasonik)

// ===================== Konfigurasi WiFi =====================
#define WIFI_SSID     "duno"
#define WIFI_PASSWORD "23571113"

// ===================== URL Google Sheets =====================
String sheet_url = "https://script.google.com/macros/s/AKfycbxEM4eBS8H7MFzBTjxN2KICNB9qltNQzvQMWYjs_20R3sH0ztFR4wfoBy9seIjLEvBQ/exec";

// ===================== Objek =====================
MFRC522 rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2); // ✅ Alamat fix 0x27 sesuai hasil scan

// ===================== Mapping UID → Nama =====================
String getNameByUID(String uid) {
  if (uid == "C533D605") return "Nizar";
  if (uid == "23025611") return "Ghitrif";
  if (uid == "97449604") return "Siswa";
  return "";
}

// ===================== URL Encode =====================
String urlEncode(String str) {
  String encoded = "";
  for (int i = 0; i < str.length(); i++) {
    char c = str.charAt(i);
    if (c == ' ')      encoded += "%20";
    else if (c == '&') encoded += "%26";
    else if (c == '=') encoded += "%3D";
    else if (c == '+') encoded += "%2B";
    else               encoded += c;
  }
  return encoded;
}

// ===================== Cek Apakah Respons Gagal =====================
bool isResponseError(String result) {
  return result == "WiFi Gagal!"    ||
         result == "Akses Ditolak!" ||
         result == "Kirim Gagal!"   ||
         result.startsWith("HTTP:");
}

// ===================== Fungsi Kirim ke Google Sheets =====================
String sendToSheet(String name, String uid) {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(3000);
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("ERROR: WiFi tidak terhubung");
      return "WiFi Gagal!";  
    }
  }

  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
  client->setInsecure();

  HTTPClient https;

  String fullUrl = sheet_url + "?name=" + urlEncode(name) + "&id=" + uid;
  Serial.println("Kirim ke: " + fullUrl);

  String response = "Kirim Gagal!";

  if (https.begin(*client, fullUrl)) {
    https.setTimeout(15000); 
    
    https.addHeader("Accept", "text/plain");
    https.addHeader("User-Agent", "ESP8266HTTPClient");

    int httpCode = https.GET();
    Serial.println("HTTP Code: " + String(httpCode));

    if (httpCode == HTTP_CODE_OK) {
      String raw = https.getString();
      raw.trim();
      Serial.println("Raw response: " + raw);

      if (raw.startsWith("<!") || raw.startsWith("<html") || raw.startsWith("<HTML")) {
        response = "Akses Ditolak!";
        Serial.println("ERROR: Google mengembalikan HTML (Kemungkinan izin akses)");
      } else {
        response = raw;
      }
      
    } else if (httpCode == 302 || httpCode == 303) {
      Serial.println("Data berhasil dieksekusi oleh Google (Mengabaikan Redirect HTML).");
      response = "Berhasil"; 

    } else {
      response = "HTTP: " + String(httpCode);
      Serial.println("ERROR HTTP Code: " + String(httpCode));
    }

    https.end();
  } else {
    Serial.println("ERROR: Gagal membuka koneksi HTTPS");
  }

  return response;
}

// ===================== Fungsi Buzzer Error =====================
void buzzerError() {
  tone(BUZZ_PIN, 500);
  delay(300);
  noTone(BUZZ_PIN);
  delay(100);
  tone(BUZZ_PIN, 500);
  delay(300);
  noTone(BUZZ_PIN);
}

// ===================== Fungsi Buzzer Sukses =====================
void buzzerSukses() {
  tone(BUZZ_PIN, 4000);
  delay(150);
  noTone(BUZZ_PIN);
}

// ===================== Fungsi Tampilan Standby =====================
void tampilkanStandby() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Sistem Presensi");
  lcd.setCursor(0, 1);
  lcd.print("Silahkan Tap...");
}

// ===================== Setup =====================
void setup() {
  Serial.begin(115200); // Menggunakan 115200 baud yang stabil di PC

  pinMode(BUZZ_PIN, OUTPUT);
  digitalWrite(BUZZ_PIN, LOW);

  SPI.begin();
  rfid.PCD_Init();

  lcd.init();
  lcd.backlight();

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Menghubungkan");
  lcd.setCursor(0, 1);
  lcd.print("ke WiFi...");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) {
    delay(500);
    attempt++;
  }

  lcd.clear();
  if (WiFi.status() == WL_CONNECTED) {
    lcd.setCursor(0, 0);
    lcd.print("WiFi Terhubung!");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP().toString());
    Serial.println("\nWiFi OK: " + WiFi.localIP().toString());
  } else {
    lcd.setCursor(0, 0);
    lcd.print("WiFi Gagal!");
    lcd.setCursor(0, 1);
    lcd.print("Cek Koneksi...");
    Serial.println("\nWiFi GAGAL");
  }

  delay(2000);
  tampilkanStandby();
}

// ===================== Loop =====================
void loop() {
  if (rfid.PICC_IsNewCardPresent()) {
    if (rfid.PICC_ReadCardSerial()) {

      buzzerSukses();

      String uidString = "";
      for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) uidString += "0";
        uidString += String(rfid.uid.uidByte[i], HEX);
      }
      uidString.toUpperCase();
      Serial.println("UID terbaca: " + uidString);

      String name = getNameByUID(uidString);

      if (name == "") {
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Kartu Unknown!");
        lcd.setCursor(0, 1);
        lcd.print(uidString);
        Serial.println("UID tidak terdaftar: " + uidString);
        buzzerError();
        delay(2000);

      } else {
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Nama: " + name);
        lcd.setCursor(0, 1);
        lcd.print("Mengirim...");

        String result = sendToSheet(name, uidString);
        Serial.println("Respons: " + result);

        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print(name.substring(0, 16));
        lcd.setCursor(0, 1);

        if (isResponseError(result)) {
          lcd.print("Gagal Terkirim!");
          buzzerError();
        } else {
          lcd.print("Telah Tercatat!");
        }

        delay(3000);
      }

      tampilkanStandby();

      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();
    }
  }

  yield();
}
