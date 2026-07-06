var ss = SpreadsheetApp.openById('1GRIrh31Eaz3as51APkkhUpsAANUQuZ4dJmH8ORdio2k');
var sheetAbsensi = ss.getSheetByName('Sheet1');
var sheetData = ss.getSheetByName('DataSiswa'); 
var timezone = "Asia/Balikpapan"; //

function doGet(e) {
  // Cek keberadaan objek e
  if (!e || !e.parameter) return ContentService.createTextOutput("Error: No parameters");

  // Ambil ID kartu
  var rawID = e.parameter.id || e.parameter.ID; // Support id atau ID
  if (!rawID) return ContentService.createTextOutput("Error: ID is missing");

  var searchID = rawID.toString().trim();

  // Pastikan sheetData ditemukan
  if (!sheetData) return ContentService.createTextOutput("Error: Sheet 'DataSiswa' tidak ditemukan!");

  var data = sheetData.getDataRange().getValues();
  var nama = "", kelas = "", ditemukan = false;

  for (var i = 1; i < data.length; i++) {
    // Cek jika baris dan kolom ID tidak kosong
    if (data[i] && data[i][0] !== undefined && data[i][0] !== null) {
      if (data[i][0].toString().trim() === searchID) {
        nama = data[i][1] || "Tanpa Nama";
        kelas = data[i][2] || "-";
        ditemukan = true;
        break;
      }
    }
  }

  if (!ditemukan) return ContentService.createTextOutput("ID [" + searchID + "] belum terdaftar");

  // Input ke Sheet1
  var Curr_Date = new Date();
  var Formatted_Date = Utilities.formatDate(Curr_Date, timezone, 'dd-MM-yyyy');
  var Formatted_Time = Utilities.formatDate(Curr_Date, timezone, 'HH:mm:ss');
  
  var lastRow = sheetAbsensi.getRange("B:B").getValues().filter(String).length;
  var nextRow = Math.max(lastRow + 1, 6); 
  
  sheetAbsensi.getRange(nextRow, 1).setValue(nextRow - 5);
  sheetAbsensi.getRange(nextRow, 2).setValue(Formatted_Date);
  sheetAbsensi.getRange(nextRow, 3).setValue(Formatted_Time);
  sheetAbsensi.getRange(nextRow, 4).setValue(nama);
  sheetAbsensi.getRange(nextRow, 5).setValue(kelas);
  sheetAbsensi.getRange(nextRow, 6).setValue("Hadir");

  return ContentService.createTextOutput("Berhasil: " + nama);
}
