// Daftar Bandara Indonesia berdasarkan kode ICAO
// Source: DGCA Indonesia
export const AIRPORT_NAMES: Record<string, string> = {
  // === JAWA ===
  WIII: "Bandar Udara Internasional Soekarno-Hatta - Jakarta",
  WIIB: "Bandar Udara Halim Perdanakusuma - Jakarta",
  WICC: "Bandar Udara Internasional Husein Sastranegara - Bandung",
  WICD: "Bandar Udara Pondok Cabe - Tangerang",
  WICQ: "Bandar Udara Atang Sendjaja - Bogor",
  WADY: "Bandar Udara Internasional Yogyakarta - Kulon Progo",
  WAHH: "Bandar Udara Internasional Adisucipto - Yogyakarta",
  WARJ: "Bandar Udara Internasional Abdul Rachman Saleh - Malang",
  WARE: "Bandar Udara Dhoho - Kediri",
  WARR: "Bandar Udara Internasional Juanda - Surabaya",
  WAWS: "Bandar Udara Internasional Ahmad Yani - Semarang",
  WARU: "Bandar Udara Internasional Adi Soemarmo - Solo",
  WARQ: "Bandar Udara Adi Sumarmo - Solo",
  WIHG: "Bandar Udara Cijulang - Pangandaran",

  // === BALI & NUSA TENGGARA ===
  WADD: "Bandar Udara Internasional I Gusti Ngurah Rai - Bali",
  WADW: "Bandar Udara Lombok Internasional - Lombok",
  WATC: "Bandar Udara El Tari - Kupang",
  WATE: "Bandar Udara Haliwen - Atambua",

  // === SUMATERA ===
  WIMM: "Bandar Udara Internasional Kualanamu - Medan",
  WIMB: "Bandar Udara Binaka - Gunung Sitoli",
  WIME: "Bandar Udara Depati Parbo - Kerinci",
  WIMG: "Bandar Udara Tabing - Padang",
  WIBB: "Bandar Udara Depati Amir - Pangkal Pinang",
  WIEE: "Bandar Udara Internasional Minangkabau - Padang",
  WIPB: "Bandar Udara Internasional Sultan Badaruddin II - Palembang",
  WIPP: "Bandar Udara Internasional Sultan Mahmud Badaruddin II - Palembang",
  WIJJ: "Bandar Udara Sultan Thaha - Jambi",
  WIBT: "Bandar Udara Rokan - Rengat",
  WIDN: "Bandar Udara Tanjung Harapan - Tanjung Balai",
  WIKB: "Bandar Udara Depati Parbo - Sungai Penuh",
  WIGG: "Bandar Udara Fatmawati Soekarno - Bengkulu",
  WIKT: "Bandar Udara Internasional H.A.S. Hanandjoeddin - Tanjung Pandan",
  WILP: "Bandar Udara Pekanbaru - Pekanbaru",
  WIOO: "Bandar Udara Rembele - Banda Aceh",
  WITB: "Bandar Udara Sultan Iskandar Muda - Banda Aceh",
  WIUB: "Bandar Udara Silangit - Tapanuli",
  WIVO: "Bandar Udara Cut Nyak Dhien - Nagan Raya",

  // === KALIMANTAN ===
  WBGG: "Bandar Udara Internasional Kinabalu - Kuching",
  WAOO: "Bandar Udara H. Asan - Sampit",
  WBBM: "Bandar Udara Syamsudin Noor - Banjarmasin",
  WBCO: "Bandar Udara Tjilik Riwut - Palangkaraya",
  WBIJ: "Bandar Udara Iskandar - Pangkalan Bun",
  WRII: "Bandar Udara Supadio - Pontianak",
  WRLL: "Bandar Udara Internasional Aji Pangeran Tumenggung Pranoto - Samarinda",
  WRSP: "Bandar Udara Internasional Syamsudin Noor - Banjarmasin",
  WRRM: "Bandar Udara Tjilik Riwut - Palangkaraya",
  WRLH: "Bandar Udara Internasional Supadio - Pontianak",

  // === SULAWESI ===
  WAMM: "Bandar Udara Internasional Sultan Hasanuddin - Makassar",
  WAMH: "Bandar Udara Tampa Padang - Mamuju",
  WAMJ: "Bandar Udara Andi Jemma - Masamba",
  WAMR: "Bandar Udara Sulteng Palu - Palu",
  WAMT: "Bandar Udara Mopah - Merauke",
  WANR: "Bandar Udara Sam Ratulangi - Manado",
  WAPN: "Bandar Udara Pogogul - Buol",
  WAPO: "Bandar Udara Kasiguncu - Poso",
  WAPP: "Bandar Udara Mutiara - Palu",
  WAPT: "Bandar Udara Tanah Pantai - Morowali",
  WARH: "Bandar Udara Haluoleo - Kendari",
  WAWB: "Bandar Udara Bolaang - Bolaang Mongondow",
  WAWC: "Bandar Udara Naha - Tahuna",
  WAWD: "Bandar Udara Matindok - Luwuk",
  WAWO: "Bandar Udara Ratulangi - Manado",

  // === MALUKU & PAPUA ===
  WAPE: "Bandar Udara Pattimura - Ambon",
  WAEE: "Bandar Udara Frans Kaisiepo - Biak",
  WAEI: "Bandar Udara Mozes Kilangin - Timika",
  WAFJ: "Bandar Udara Utarom - Fakfak",
  WAFL: "Bandar Udara Lereh - Jayapura",
  WAFP: "Bandar Udara Dumatubun - Tual",
  WAHQ: "Bandar Udara Sentani - Jayapura",
  WAJB: "Bandar Udara Jaisolo - Biak",
  WAKK: "Bandar Udara Dobo - Dobo",
  WALK: "Bandar Udara Mili - Mili",
  WALM: "Bandar Udara Rar Gwamar - Dobo",
  WAQN: "Bandar Udara Kaimana - Kaimana",
  WASM: "Bandar Udara Sarmi - Sarmi",
  WASR: "Bandar Udara Maimun Saleh - Sabang",
  WAST: "Bandar Udara Babullah - Ternate",
  WASW: "Bandar Udara Wadin - Saparua",
  WATW: "Bandar Udara Wai - Tual",
  WAXX: "Bandar Udara Mopah - Merauke",
  WAYX: "Bandar Udara Bandara Moa - Masela",
  WATM: "Bandar Udara Turelelo - Soa",
  WATT: "Bandar Udara Babullah - Ternate",

  // === KODE EKSTENSI ===
  WARW: "Bandar Udara Internasional Adi Sumarmo - Solo",
};

// Fungsi untuk mendapatkan nama bandara
export function getAirportName(icaoCode: string): string | null {
  return AIRPORT_NAMES[icaoCode.toUpperCase()] || null;
}
