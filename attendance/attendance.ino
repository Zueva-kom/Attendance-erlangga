#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>

// ===================== Definisi Pin (Sesuai Rangkaian Pin-to-Pin) =====================
#define SS_PIN    D4
#define RST_PIN   D3   
#define BUZZ_PIN  D8   // Pin D8 (GPIO15) sesuai diagram rangkaian kamu

// ===================== Konfigurasi WiFi =====================
#define WIFI_SSID     "duno"
#define WIFI_PASSWORD "23571113"

// ===================== URL API Vercel Dashboard =====================
// Ganti domain di bawah ini dengan URL hasil deploy Vercel-mu nanti
String vercel_api_url = "https://nama-proyek-kamu.vercel.app/api/attendance";

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
  client->setInsecure(); // Mengabaikan validasi SSL fingerprint agar awet tanpa sertifikat up-to-date

  HTTPClient https;
  String response = "Kirim Gagal!";

  if (https.begin(*client, vercel_api_url)) {
    https.setTimeout(10000); // Batas waktu tunggu respon 10 detik
    https.addHeader("Content-Type", "application/json");

    // Mengirim data minimalis. Waktu dan Nama akan di-mapping oleh Vercel Backend
    String jsonPayload = "{\"device_id\":\"MESIN_ITK_01\",\"uid\":\"" + uid + "\"}";
    Serial.println("Kirim Payload: " + jsonPayload);

    int httpCode = https.POST(jsonPayload);
    Serial.println("HTTP Code dari Vercel: " + String(httpCode));

    if (httpCode == HTTP_CODE_OK || httpCode == 201) {
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

// ===================== Indikator Suara =====================
void buzzerError() {
  tone(BUZZ_PIN, 500); delay(300); noTone(BUZZ_PIN); delay(100);
  tone(BUZZ_PIN, 500); delay(300); noTone(BUZZ_PIN);
}

void buzzerSukses() {
  tone(BUZZ_PIN, 4000); delay(150); noTone(BUZZ_PIN);
}

void tampilkanStandby() {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Sistem Presensi");
  lcd.setCursor(0, 1); lcd.print("Silahkan Tap...");
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
  lcd.setCursor(0, 0); lcd.print("Menghubungkan");
  lcd.setCursor(0, 1); lcd.print("ke WiFi...");

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
    Serial.println("\nWiFi Terhubung OK: " + WiFi.localIP().toString());
  } else {
    lcd.setCursor(0, 0); lcd.print("WiFi Gagal!");
    lcd.setCursor(0, 1); lcd.print("Cek Koneksi...");
    Serial.println("\nWiFi Gagal Terhubung");
  }

  delay(2000);
  tampilkanStandby();
}

// ===================== Main Loop =====================
void loop() {
  // Deteksi kartu baru
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    
    buzzerSukses(); // Bunyi instan begitu kartu menyentuh sensor

    // Mengubah UID byte ke format String HEX
    String uidString = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (rfid.uid.uidByte[i] < 0x10) uidString += "0";
      uidString += String(rfid.uid.uidByte[i], HEX);
    }
    uidString.toUpperCase();
    Serial.println("\nUID Terbaca: " + uidString);

    // Tampilan proses di LCD
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("UID: " + uidString);
    lcd.setCursor(0, 1); lcd.print("Mengirim data...");

    // Mengirimkan data UID ke Vercel API
    String result = sendJsonToVercel(uidString);
    Serial.println("Respon Server Backend: " + result);

    lcd.clear();
    
    // Pastikan respon tidak gagal sebelum melakukan parsing
    if (result != "Kirim Gagal!" && !result.startsWith("HTTP_ERR_")) {
      
      // 1. Ekstrak Nama dari JSON Mentah
      // Mencari posisi teks setelah "name":" sampai tanda kutip berikutnya
      String namaSiswa = "Unknown";
      int nameIndex = result.indexOf("\"name\":\"");
      if (nameIndex != -1) {
        int startPos = nameIndex + 8; // Panjang dari "\"name\":\"" adalah 8 karakter
        int endPos = result.indexOf("\"", startPos);
        if (endPos != -1) {
          namaSiswa = result.substring(startPos, endPos);
        }
      }
      
      // Batasi tampilan nama maksimal 16 karakter agar muat di LCD
      if (namaSiswa.length() > 16) {
        namaSiswa = namaSiswa.substring(0, 16);
      }

      // 2. Logika Menampilkan Status & Nama di LCD berdasarkan isi String respons
      if (result.indexOf("\"status\":\"MASUK\"") >= 0) {
        lcd.setCursor(0, 0); lcd.print("Masuk: " + namaSiswa);
        lcd.setCursor(0, 1); lcd.print("Absen Berhasil!");
      } 
      else if (result.indexOf("\"status\":\"KELUAR\"") >= 0) {
        lcd.setCursor(0, 0); lcd.print("Pulang: " + namaSiswa);
        lcd.setCursor(0, 1); lcd.print("Selamat Pulang!");
      } 
      else if (result.indexOf("\"status\":\"TERLAMBAT\"") >= 0) {
        lcd.setCursor(0, 0); lcd.print("Si " + namaSiswa);
        lcd.setCursor(0, 1); lcd.print("Tercatat Telat!");
      }
      else {
        lcd.setCursor(0, 0); lcd.print("Status Unknown");
        lcd.setCursor(0, 1); lcd.print(namaSiswa);
      }

    } else {
      // Jika terjadi error jaringan atau server mati
      lcd.setCursor(0, 0); lcd.print("Gagal Kirim!");
      lcd.setCursor(0, 1); lcd.print("Cek Server/WiFi");
      buzzerError();
    }

    // Jeda 3 detik agar user bisa membaca status di LCD sebelum standby kembali
    delay(3000);
    tampilkanStandby();

    // Menghentikan pembacaan kartu saat ini
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }
  
  yield(); // Menjaga stabilitas background process ESP8266 agar tidak crash/watchdog trigger
}