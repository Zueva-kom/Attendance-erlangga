#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>

// ===================== Definisi Pin (Sesuai Rangkaian Pin-to-Pin) =====================
#define SS_PIN    D4
#define RST_PIN   D3   
#define BUZZ_PIN  D8   // Pin D8 (GPIO15)

// ===================== Konfigurasi WiFi =====================
#define WIFI_SSID     "Kalorimeter"
#define WIFI_PASSWORD "Modul_2#"

// ===================== IDENTITAS MESIN ABSENSI =====================
// Sesuaikan dengan nama kelas. Harus sinkron dengan data "kelas" di siswa.json (misal: "TKJ 1")
const String DEVICE_ID = "TKJ 1";

// URL API Vercel Dashboard
String vercel_api_url = "https://attendance-airlangga.vercel.app/api/attendance";

MFRC522 rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2); 

// ===================== Fungsi Kirim JSON POST ke Vercel =====================
String sendJsonToVercel(String uid) {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(3000);
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("ERROR: WiFi tidak terhubung");
      return "WiFi Gagal!";  
    }
  }

  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
  client->setInsecure(); // Mengabaikan validasi SSL fingerprint

  HTTPClient https;
  String response = "Kirim Gagal!";

  if (https.begin(*client, vercel_api_url)) {
    https.setTimeout(8000); // Batas waktu tunggu respon 8 detik
    https.addHeader("Content-Type", "application/json");

    // Mengirim payload dengan identitas DEVICE_ID yang dinamis sesuai kelas
    String jsonPayload = "{\"device_id\":\"" + DEVICE_ID + "\",\"uid\":\"" + uid + "\"}";
    Serial.println("Kirim Payload: " + jsonPayload);

    int httpCode = https.POST(jsonPayload);
    Serial.println("HTTP Code dari Vercel: " + String(httpCode));

    // Menerima semua respon (termasuk status 403 / 404 agar pesan REJECTED terbaca)
    if (httpCode > 0) {
      response = https.getString();
      response.trim();
    } else {
      response = "HTTP_ERR_" + String(httpCode);
    }
    https.end();
  } else {
    Serial.println("ERROR: Gagal membuka koneksi HTTPS");
  }

  return response;
}

// ===================== Indikator Suara (Buzzer) =====================
void buzzerSukses() {
  tone(BUZZ_PIN, 4000); delay(150); noTone(BUZZ_PIN);
}

void buzzerDitolak() {
  // Bunyi alarm panjang menandakan salah kelas / kartu tidak terdaftar
  tone(BUZZ_PIN, 600); delay(800); noTone(BUZZ_PIN);
}

void buzzerError() {
  tone(BUZZ_PIN, 500); delay(300); noTone(BUZZ_PIN); delay(100);
  tone(BUZZ_PIN, 500); delay(300); noTone(BUZZ_PIN);
}

void tampilkanStandby() {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Presensi " + DEVICE_ID);
  lcd.setCursor(0, 1); lcd.print("Silahkan Tap...");
}

// ===================== Parsing JSON Sederhana via String =====================
String ambilNilaiJson(String json, String key) {
  String target = "\"" + key + "\":\"";
  int index = json.indexOf(target);
  if (index == -1) return "";
  int startPos = index + target.length();
  int endPos = json.indexOf("\"", startPos);
  if (endPos != -1) {
    return json.substring(startPos, endPos);
  }
  return "";
}

// ===================== Setup Perangkat =====================
void setup() {
  Serial.begin(115200);
  
  pinMode(BUZZ_PIN, OUTPUT);
  digitalWrite(BUZZ_PIN, LOW);

  SPI.begin();
  rfid.PCD_Init();

  lcd.init();
  lcd.backlight();
  lcd.clear();
  tone(BUZZ_PIN, 4000); delay(150); noTone(BUZZ_PIN);
  lcd.setCursor(0, 0); lcd.print("Booting Mesin...");
  lcd.setCursor(0, 1); lcd.print("Kelas: " + DEVICE_ID);
  delay(1500);

  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Koneksi WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) {
    delay(500);
    attempt++;
  }

  lcd.clear();
  if (WiFi.status() == WL_CONNECTED) {
    lcd.setCursor(0, 0); lcd.print("WiFi Terhubung!");
    lcd.setCursor(0, 1); lcd.print(WiFi.localIP().toString());
    tone(BUZZ_PIN, 4000); delay(200); noTone(BUZZ_PIN);
    tone(BUZZ_PIN, 4000); delay(200); noTone(BUZZ_PIN);
  } else {
    lcd.setCursor(0, 0); lcd.print("WiFi Gagal!");
    lcd.setCursor(0, 1); lcd.print("Mode Offline...");
    tone(BUZZ_PIN, 600); delay(800); noTone(BUZZ_PIN);
  }

  delay(2000);
  tampilkanStandby();
}

// ===================== Main Loop =====================
void loop() {
  // Deteksi adanya RFID Card
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    tone(BUZZ_PIN, 4000); delay(150); noTone(BUZZ_PIN);
    
    // Mengubah UID byte ke format String HEX
    String uidString = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (rfid.uid.uidByte[i] < 0x10) uidString += "0";
      uidString += String(rfid.uid.uidByte[i], HEX);
    }
    uidString.toUpperCase();
    Serial.println("\nUID Terbaca: " + uidString);

    // Tampilan proses kirim data di LCD
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("UID: " + uidString);
    lcd.setCursor(0, 1); lcd.print("Verifikasi...");

    // Mengirimkan data UID ke Vercel API
    String result = sendJsonToVercel(uidString);
    Serial.println("Respon Server Backend: " + result);

    lcd.clear();
    
    if (result != "Kirim Gagal!" && !result.startsWith("HTTP_ERR_")) {
      
      // Ekstrak parameter penting dari respon JSON Vercel
      String statusAbsen = ambilNilaiJson(result, "status");
      String namaUser    = ambilNilaiJson(result, "name");
      String pesanError  = ambilNilaiJson(result, "message");

      if (namaUser.length() > 16) namaUser = namaUser.substring(0, 16);

      // --- LOGIKA RESPON TAMPILAN & AUDIO ---
      
      if (statusAbsen == "REJECTED") {
        // KONDISI 1: Kartu ditolak (Salah kelas atau tidak terdaftar)
        lcd.setCursor(0, 0); lcd.print("AKSES DITOLAK!");
        lcd.setCursor(0, 1); lcd.print(pesanError != "" ? pesanError : "Salah Kelas");
        buzzerDitolak();
      } 
      else if (statusAbsen == "MASUK") {
        // KONDISI 2: Berhasil Absen Masuk (Siswa / Guru)
        lcd.setCursor(0, 0); lcd.print(namaUser);
        lcd.setCursor(0, 1); lcd.print("Absen Berhasil!");
        buzzerSukses();
      } 
      else if (statusAbsen == "KELUAR") {
        // KONDISI 3: Berhasil Absen Pulang
        lcd.setCursor(0, 0); lcd.print(namaUser);
        lcd.setCursor(0, 1); lcd.print("Selamat Pulang!");
        buzzerSukses();
      } 
      else if (statusAbsen == "TERLAMBAT") {
        // KONDISI 4: Terlambat Masuk
        lcd.setCursor(0, 0); lcd.print(namaUser);
        lcd.setCursor(0, 1); lcd.print("Tercatat Telat!");
        buzzerSukses();
      }
      else {
        // KONDISI 5: Penanganan di luar jam operasional
        lcd.setCursor(0, 0); lcd.print("Sesi Selesai");
        lcd.setCursor(0, 1); lcd.print(namaUser);
        buzzerSukses();
      }

    } else {
      // Kondisi jika komunikasi ke backend Vercel putus
      lcd.setCursor(0, 0); lcd.print("Gagal Koneksi");
      lcd.setCursor(0, 1); lcd.print("Hubungi Admin");
      buzzerError();
    }

    // Jeda pembacaan agar user sempat membaca info di layar LCD
    delay(3500);
    tampilkanStandby();

    // Hentikan komunikasi crypto kartu saat ini agar tidak membaca berulang-ulang
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }
  
  yield(); // Amankan modul dari tumpukan instruksi watchdog ESP8266
}
