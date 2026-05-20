#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>

// Definisi Pin
#define SS_PIN    D4
#define RST_PIN   D3
#define TRIG_PIN  D0
#define ECHO_PIN  3   // Pin RX (GPIO 3)
#define BUZZ_PIN  D8  // Buzzer Pasif

// Definisi WIFI
#define WIFI_SSID "Attendance System IEEE"
#define WIFI_PASSWORD "PIOTEJAYA"

// SpreadSheet URL
String sheet_url = "https://script.google.com/a/macros/student.itk.ac.id/s/AKfycbzjUD3lg9TMBpgqthh1AdyV69NTwSGer6sXGq0JBIk-eV-9JQUs_YCd3Gq48s82ea1-MA/exec?name=";

MFRC522 rfid(SS_PIN, RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);

unsigned long lastDetectionTime = 0; 
const unsigned long displayTimeout = 5000; 
bool isDisplayActive = false;

// Fungsi untuk mengirim data ke Google Sheets
void sendToGoogleSheets(String data) {
  if (WiFi.status() == WL_CONNECTED) {
    std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
    client->setInsecure(); // Mengabaikan verifikasi SSL untuk kemudahan

    HTTPClient https;
    String url = sheet_url + data;

    if (https.begin(*client, url)) {
      int httpCode = https.GET();
      if (httpCode > 0) {
        Serial.println("HTTP Response code: " + String(httpCode));
      } else {
        Serial.printf("[HTTPS] GET... failed, error: %s\n", https.errorToString(httpCode).c_str());
      }
      https.end();
    }
  }
}

void setup() {
  Serial.begin(9600);
  
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZ_PIN, OUTPUT);

  // Inisialisasi WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");

  SPI.begin();
  rfid.PCD_Init();
  
  lcd.init();
  lcd.noBacklight(); // Mulai dengan LCD mati
}

void loop() {
  // 1. Logika deteksi jarak dengan Ultrasonik
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  
  // Timeout 20ms untuk mencegah hang
  long duration = pulseIn(ECHO_PIN, HIGH, 20000); 
  int distance = (duration == 0) ? 999 : duration * 0.034 / 2;

  // 2. Logika Display On/Off berdasarkan jarak
  if (distance > 0 && distance < 20) {
    lastDetectionTime = millis(); 
    
    if (!isDisplayActive) {
      lcd.backlight();
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Pengmas IEEE ");
      lcd.setCursor(0, 1);
      lcd.print("Silahkan Tap...");
      isDisplayActive = true;
    }

    // 3. Cek RFID jika ada kartu yang ditempelkan
    if (rfid.PICC_IsNewCardPresent()) { 
      if (rfid.PICC_ReadCardSerial()) { 
        
        // Bunyi Buzzer (Tone)
        tone(BUZZ_PIN, 2000); 
        delay(150);
        noTone(BUZZ_PIN);

        // Ambil UID Kartu
        String uidString = "";
        for (byte i = 0; i < rfid.uid.size; i++) {
          uidString += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
          uidString += String(rfid.uid.uidByte[i], HEX);
        }
        uidString.toUpperCase();

        // Tampilkan di LCD
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("ID: " + uidString);
        lcd.setCursor(0, 1);
        lcd.print("Proses Absen...");

        // Kirim ke Google Sheets
        sendToGoogleSheets(uidString);
        
        lcd.setCursor(0, 1);
        lcd.print("Berhasil Absen!");
        
        delay(2000); 
        
        // Kembali ke tampilan awal
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Selamat Datang ");
        lcd.setCursor(0, 1);
        lcd.print("Silahkan Tap...");
        
        // Reset state RFID
        rfid.PICC_HaltA();
        rfid.PCD_StopCrypto1();
        lastDetectionTime = millis(); 
      }
    }
  } 
  
  // 4. Logika Mematikan LCD (Timeout)
  if (isDisplayActive && (millis() - lastDetectionTime > displayTimeout)) {
    lcd.noBacklight();
    lcd.clear();
    isDisplayActive = false;
  }

  yield(); 
}
