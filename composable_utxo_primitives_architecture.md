# CashBlocks — Composable UTXO Primitives on Bitcoin Cash

Dokumen ini menjelaskan **arsitektur sistem** dan **hal-hal penting yang harus diperhatikan** sebelum membangun *Composable UTXO Primitives* di Bitcoin Cash (BCH), dengan fokus pada tiga primitive utama:

1. **Vault Primitive**
2. **Time-State Primitive**
3. **Oracle Proof Primitive**

Tujuan utama proyek ini adalah **unlocking UTXO capabilities** dengan menyediakan *building blocks* yang dapat dikomposisi oleh developer lain, bukan membangun aplikasi end-user secara langsung.

---

## 1. Prinsip Desain Dasar

### 1.1 UTXO-First, Bukan Account-First
- Tidak ada global state
- Semua state direpresentasikan sebagai **UTXO yang berevolusi**
- Setiap transaksi = transisi state yang tervalidasi oleh script

### 1.2 Composability by Consumption
- Primitive tidak saling memanggil
- Komposisi terjadi dengan **mengonsumsi beberapa UTXO dalam satu transaksi**
- Jika satu primitive gagal validasi → transaksi gagal

### 1.3 Deterministik & Stateless
- Script tidak menyimpan memori
- Semua parameter eksplisit di locking script atau data output
- Tidak ada dependency ke backend atau server

---

## 2. Arsitektur Tingkat Tinggi

```text
+---------------------------+
|  Application / SDK Layer  |
|  (JS SDK, CLI, Examples)  |
+-------------+-------------+
              |
+-------------v-------------+
|   Composable UTXO Layer   |
|  Vault | TimeState | Oracle|
+-------------+-------------+
              |
+-------------v-------------+
|   Bitcoin Cash VM (UTXO)  |
|   Script + CashTokens     |
+---------------------------+
```

Primitive berada **tepat di atas BCH VM**, sehingga:
- Bisa digunakan oleh semua jenis aplikasi
- Tidak terkunci pada satu domain (DeFi, game, DAO, dll)

---

## 3. Vault Primitive Architecture

### 3.1 Tujuan
Menyediakan UTXO yang menyimpan **dana + kebijakan pengeluaran (spending policy)**.

### 3.2 Parameter Utama
- `owner_pubkey`
- `spend_limit`
- `timelock` (opsional)
- `whitelist` (address atau script hash)

### 3.3 State Model
- Vault tidak menyimpan saldo sebagai variabel
- Saldo = nilai BCH di UTXO
- Policy berpindah ke output vault berikutnya

### 3.4 Aturan Validasi
- Transaksi harus ditandatangani owner
- Output harus:
  - Vault lanjutan dengan policy valid, atau
  - Transfer yang memenuhi limit & whitelist

---

## 4. Time-State Primitive Architecture

### 4.1 Tujuan
Mengizinkan **perubahan hak dan perilaku UTXO berdasarkan waktu**.

### 4.2 Model Fase
- Phase 0: Locked
- Phase 1: Restricted
- Phase 2: Unrestricted

### 4.3 Parameter Waktu
- `start_time`
- `phase_1_time`
- `phase_2_time`

### 4.4 Validasi Script
- Mengecek waktu blok / locktime
- Menentukan fase aktif
- Memastikan output selanjutnya sesuai fase

### 4.5 Komposisi
- Digunakan bersama Vault untuk vesting, treasury unlock, salary, grant

---

## 5. Oracle Proof Primitive Architecture

### 5.1 Tujuan
Memungkinkan kontrak BCH **memverifikasi data off-chain** secara trust-minimized.

### 5.2 Model Oracle
- Signature-based oracle
- Tidak ada oracle network global

### 5.3 Parameter Utama
- `oracle_pubkey`
- `domain_separator`
- `expiry`
- `nonce`

### 5.4 Validasi Script
- Signature valid
- Format pesan sesuai
- Timestamp belum kedaluwarsa
- Output selanjutnya konsisten

---

## 6. Pola Komposisi Antar Primitive

### Contoh: Conditional Treasury Spend

Satu transaksi mengonsumsi:
- Vault UTXO (policy dana)
- Time-State UTXO (fase waktu)
- Oracle Proof UTXO (kondisi eksternal)

Jika salah satu script gagal → transaksi tidak valid.

Tidak ada:
- Admin
- Backend
- Multisig manual

---

## 7. Hal-Hal Penting Sebelum Membangun

### 7.1 Scope Control
- Jangan terlalu banyak fitur
- Prioritaskan primitive yang **stabil & reusable**

### 7.2 Interface Stability
- Perubahan parameter = breaking change
- Versi primitive harus eksplisit

### 7.3 Security First
- Hindari logic ambigu
- Batasi cabang kondisi
- Anggap semua input berbahaya

### 7.4 UX untuk Developer
- Dokumentasi lebih penting dari fitur tambahan
- Contoh komposisi wajib ada

### 7.5 Hackathon Readiness
- Demo kecil tapi nyata
- Bisa dijalankan tanpa UI kompleks
- Fokus ke *capability unlocked*, bukan UI

---

## 8. Output yang Diharapkan

- Kontrak CashScript untuk tiap primitive
- Example komposisi nyata
- SDK atau helper minimal
- Dokumentasi yang menjelaskan pola desain

---

## 9. Posisi Proyek di Ekosistem BCH

Composable UTXO Primitives bertujuan menjadi:
- Infra dasar untuk developer BCH
- Standar tidak resmi untuk kontrak UTXO kompleks
- Pondasi bagi aplikasi DeFi, DAO, game, dan tools di masa depan

---

**End of Document**

