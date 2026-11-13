#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>

// ===================== Definisi Pin =====================
#define SS_PIN    D4
#define RST_PIN   D3   
#define BUZZ_PIN  D8   // Pin D8 (GPIO15)

// ===================== Konfigurasi WiFi =====================
#define WIFI_SSID     "ITK-B.X"
#define WIFI_PASSWORD "K@mpusM3rdeka!"

// ===================== IDENTITAS MESIN =====================
const String DEVICE_ID = "XI TJKT"; // Sesuaikan dengan nama_kelas di database
String local_api_url = "http://10.160.21.135:8000/api/attendance";

MFRC522 rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2); 

// ===================== Variabel Marquee Standby (Tanpa Delay) =====================
unsigned long timerScroll = 0;
int posisiScroll = 0;
bool modeStandby = false; 
// Tambahkan banyak spasi di belakang agar teks mengulang dengan halus
String teksStandby = "Presensi " + DEVICE_ID + "        "; 

// ===================== Fungsi Kirim API Lokal =====================
String sendJsonToVercel(String uid) {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(3000);
    if (WiFi.status() != WL_CONNECTED) return "WiFi Gagal!";  
  }

  WiFiClient client; // Gunakan WiFiClient standar untuk HTTP Lokal
  HTTPClient http;
  String response = "Kirim Gagal!";

  if (http.begin(client, local_api_url)) {
    http.setTimeout(5000); 
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Accept", "application/json");

    String jsonPayload = "{\"device_id\":\"" + DEVICE_ID + "\",\"uid\":\"" + uid + "\"}";
    int httpCode = http.POST(jsonPayload);

    if (httpCode > 0) {
      response = http.getString();
      response.trim();
    } else {
      response = "HTTP_ERR_" + String(httpCode);
    }
    http.end();
  }
  return response;
}

// ===================== Indikator Suara =====================
void buzzerSukses() { tone(BUZZ_PIN, 4000); delay(150); noTone(BUZZ_PIN); }
void buzzerDitolak() { tone(BUZZ_PIN, 600); delay(800); noTone(BUZZ_PIN); }
void buzzerError() { tone(BUZZ_PIN, 500); delay(300); noTone(BUZZ_PIN); delay(100); tone(BUZZ_PIN, 500); delay(300); noTone(BUZZ_PIN); }

// ===================== Fungsi Standby Baru =====================
void masukModeStandby() {
  lcd.clear();
  lcd.setCursor(0, 1); 
  lcd.print("Silahkan Tap..."); // Baris bawah diam
  
  modeStandby = true;   // Aktifkan animasi teks baris atas
  posisiScroll = 0;
  timerScroll = millis();
}

// ===================== Parsing JSON =====================
String ambilNilaiJson(String json, String key) {
  String target = "\"" + key + "\":\"";
  int index = json.indexOf(target);
  if (index == -1) return "";
  int startPos = index + target.length();
  int endPos = json.indexOf("\"", startPos);
  if (endPos != -1) return json.substring(startPos, endPos);
  return "";
}

// ===================== Fungsi Teks Berjalan (Untuk Nama) =====================
void tampilkanPesanBerjalan(String baris1, String baris2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(baris1); 

  if (baris2.length() <= 16) {
    lcd.setCursor(0, 1);
    lcd.print(baris2);
    delay(3500); 
  } else {
    String paddedText = baris2 + "                "; 
    for (int posisi = 0; posisi <= paddedText.length() - 16; posisi++) {
      lcd.setCursor(0, 1);
      lcd.print(paddedText.substring(posisi, posisi + 16));
      delay(300); 
    }
    delay(500); 
  }
}

// ===================== Setup =====================
void setup() {
  Serial.begin(115200);
  Serial.println("\n--- Sistem Presensi Dimulai ---");
  delay(100);
  pinMode(BUZZ_PIN, OUTPUT);
  digitalWrite(BUZZ_PIN, LOW);

  SPI.begin();
  rfid.PCD_Init();
  lcd.init();
  lcd.backlight();
  
  lcd.clear();
  buzzerSukses();
  lcd.setCursor(0, 0); lcd.print("Memulai Sistem...");
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
    buzzerSukses(); buzzerSukses();
  } else {
    lcd.setCursor(0, 0); lcd.print("WiFi Gagal!");
    lcd.setCursor(0, 1); lcd.print("Mode Offline...");
    buzzerError();
  }

  delay(2000);
  masukModeStandby(); // Panggil fungsi standby baru
}

// ===================== Main Loop =====================
void loop() {

  // --- EFEK TEKS BERJALAN SAAT STANDBY (TANPA DELAY AGAR RFID TIDAK LAG) ---
  if (modeStandby) {
    if (millis() - timerScroll >= 350) { // 350ms adalah kecepatan gerak teks
      timerScroll = millis();
      lcd.setCursor(0, 0);
      
      // Menampilkan 16 huruf sesuai posisi scroll
      lcd.print(teksStandby.substring(posisiScroll, posisiScroll + 16));
      
      posisiScroll++;
      if (posisiScroll > teksStandby.length() - 16) {
        posisiScroll = 0; // Ulangi dari awal jika sudah di ujung
      }
    }
  }

  // --- LOGIKA BACA KARTU RFID ---
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    modeStandby = false;
    buzzerSukses();
    
    String uidString = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (rfid.uid.uidByte[i] < 0x10) uidString += "0";
      uidString += String(rfid.uid.uidByte[i], HEX);
    }
    uidString.toUpperCase();

    Serial.println("\n[RFID] Kartu terdeteksi!");
    Serial.println("[RFID] UID: " + uidString);
    Serial.println("[HTTP] Menghubungi: " + local_api_url);

    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("Verifikasi...");

    String result = sendJsonToVercel(uidString);

    Serial.println("[HTTP] Respon: " + result);

    if (result != "Kirim Gagal!" && !result.startsWith("HTTP_ERR_")) {
      String statusAbsen = ambilNilaiJson(result, "status");
      String namaUser    = ambilNilaiJson(result, "name");
      String pesanError  = ambilNilaiJson(result, "message");

      Serial.println("[HASIL] Status: " + statusAbsen + " | Nama: " + namaUser);

      if (statusAbsen == "REJECTED") {
        buzzerDitolak(); 
        String pesan = (pesanError != "") ? pesanError : "Salah Kelas";
        tampilkanPesanBerjalan("AKSES DITOLAK!", pesan);
      } 
      // ... lanjutkan blok if-else bawaan Anda
      else if (statusAbsen == "MASUK") { 
        buzzerSukses();
        tampilkanPesanBerjalan("Absen Berhasil!", namaUser);
      } 
      else if (statusAbsen == "KELUAR") {
        buzzerSukses();
        tampilkanPesanBerjalan("Selamat pulang", namaUser);
      }
      else if (statusAbsen == "TERLAMBAT") {
        buzzerSukses();
        tampilkanPesanBerjalan("Tercatat Telat!", namaUser);
      }
      else if (statusAbsen == "SUDAH_ABSEN") {
        buzzerSukses(); 
        tampilkanPesanBerjalan("Sudah Absen!", namaUser);
      }
      else {
        buzzerSukses();
        tampilkanPesanBerjalan("Diluar Jam Ops", namaUser);
      }
    } else {
      lcd.clear();
      lcd.setCursor(0, 0); lcd.print("Gagal Koneksi");
      lcd.setCursor(0, 1); lcd.print("Hubungi Admin");
      buzzerError();
      delay(3000);
    }

    masukModeStandby(); // Kembali ke tampilan Standby dan nyalakan lagi animasinya

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }
  
  yield(); 
}
