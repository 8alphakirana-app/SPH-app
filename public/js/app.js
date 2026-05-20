/* ============================================================
   SPH App - Frontend JavaScript
============================================================ */

let currentUser = null;
let rejectTargetId = null;
let productRowCount = 0;
let editTargetId = null;
let editProductRowCount = 0;

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', async () => {
       try {
              const res = await api('/api/auth/me');
              if (res.ok) {
                     const user = await res.json();
                     setUser(user);
                     showApp();
                     showPage('dashboard');
              } else {
                     showLogin();
              }
       } catch {
              showLogin();
       }
});

// ===================== AUTH =====================
document.getElementById('form-login').addEventListener('submit', async (e) => {
       e.preventDefault();
       const username = document.getElementById('login-username').value;
       const password = document.getElementById('login-password').value;
       const errEl = document.getElementById('login-error');
       errEl.style.display = 'none';
       try {
              const res = await api('/api/auth/login', 'POST', { username, password });
              const data = await res.json();
              if (res.ok) {
                     setUser(data.user);
                     showApp();
                     showPage('dashboard');
              } else {
                     errEl.textContent = data.error || 'Login gagal';
                     errEl.style.display = 'block';
              }
       } catch {
              errEl.textContent = 'Koneksi ke server gagal';
              errEl.style.display = 'block';
       }
});

async function logout() {
       await api('/api/auth/logout', 'POST');
       currentUser = null;
       showLogin();
}

const ROLE_LABELS = {
       admin: '👑 Admin', staff: '👤 Staff', kantor_pusat: '🏢 Kantor Pusat',
       gm: '⭐ GM', manager_keuangan: '💼 Mgr. Keuangan',
       direktur_ops: '🏭 Dir. Ops', direktur_utama: '🎯 Dir. Utama',
       marketing: '📣 Marketing', supervisor: '🔍 Supervisor',
       area_manager: '🗺️ Area Manager', gm2: '⭐ GM 2'
};
const APPROVER_ROLES = ['area_manager', 'gm', 'gm2', 'manager_keuangan', 'direktur_ops', 'direktur_utama'];
const KK_LEVEL_LABELS = { 1: 'Area Manager', 2: 'Manager Keuangan', 3: 'GM 1', 4: 'GM 2', 5: 'Direktur Operasional', 6: 'Direktur Utama' };
const AREA_KERJA_LIST = ['Banten', 'Jakarta', 'Jawa Barat', 'Sumatera', 'Kalimantan', 'Jawa Tengah', 'Jawa Timur', 'Nusa Tenggara', 'Sulawesi', 'Papua'];
const SPPD_LEVEL_LABELS = { 1: 'Area Manager', 2: 'GM 1', 3: 'GM 2' };
const LAPORAN_LEVEL_LABELS = { 1: 'Area Manager', 2: 'Manager Keuangan', 3: 'GM 1', 4: 'GM 2', 5: 'Direktur Operasional', 6: 'Direktur Utama' };
const PENCAIRAN_LEVEL_LABELS = { 1: 'Area Manager', 2: 'Manager Keuangan', 3: 'GM 1', 4: 'GM 2', 5: 'Direktur Operasional', 6: 'Direktur Utama' };
const SPPD_APPROVER_ROLES = ['area_manager', 'gm', 'gm2'];
const LAPORAN_APPROVER_ROLES = ['area_manager', 'manager_keuangan', 'gm', 'gm2', 'direktur_ops', 'direktur_utama'];
const PENCAIRAN_APPROVER_ROLES = ['area_manager', 'manager_keuangan', 'gm', 'gm2', 'direktur_ops', 'direktur_utama'];
const SPPD_ALL_ROLES = ['admin', 'kantor_pusat', 'manager_keuangan', 'area_manager', 'gm', 'gm2', 'direktur_ops', 'direktur_utama'];
const SPPD_CREATE_ROLES = ['marketing', 'supervisor', 'staff', 'admin'];

function setUser(user) {
       currentUser = user;
       document.getElementById('user-name').textContent = user.full_name;
       document.getElementById('user-role').textContent = ROLE_LABELS[user.role] || user.role;
       document.getElementById('user-avatar').textContent = user.full_name.charAt(0).toUpperCase();
       document.getElementById('top-bar-user').textContent = user.full_name;

       // Admin-only: Kelola Pengguna, Pengaturan
       if (user.role === 'admin') {
              document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
       }

       // Admin + Kantor Pusat: Semua Pengajuan
       if (user.role === 'admin' || user.role === 'kantor_pusat') {
              document.querySelectorAll('.admin-or-kp').forEach(el => el.style.display = '');
       }

       // KK menu visibility
       document.querySelectorAll('.kk-menu').forEach(el => el.style.display = '');
       if (['staff', 'admin', 'marketing', 'supervisor'].includes(user.role)) {
              document.querySelectorAll('.kk-create').forEach(el => el.style.display = '');
              document.querySelectorAll('.kk-mine').forEach(el => el.style.display = '');
       }
       if (APPROVER_ROLES.includes(user.role) || user.role === 'admin') {
              document.querySelectorAll('.kk-approver').forEach(el => el.style.display = '');
       }
       if (user.role === 'admin' || user.role === 'direktur_utama' || user.role === 'kantor_pusat') {
              document.querySelectorAll('.kk-all').forEach(el => el.style.display = '');
       }

       // SPPD menu visibility
       const isSppdCreator = SPPD_CREATE_ROLES.includes(user.role);
       const isSppdApprover = SPPD_APPROVER_ROLES.includes(user.role) || user.role === 'admin';
       const isLaporanApprover = LAPORAN_APPROVER_ROLES.includes(user.role) || user.role === 'admin';
       const isPencairanMgr = PENCAIRAN_APPROVER_ROLES.includes(user.role) || user.role === 'admin';
       const isSppdAll = SPPD_ALL_ROLES.includes(user.role);
       if (isSppdCreator || isSppdApprover || isLaporanApprover || isPencairanMgr || isSppdAll) {
              document.querySelectorAll('.sppd-menu').forEach(el => el.style.display = '');
       }
       if (isSppdCreator) {
              document.querySelectorAll('.sppd-create').forEach(el => el.style.display = '');
              document.querySelectorAll('.sppd-mine').forEach(el => el.style.display = '');
       }
       if (isSppdApprover) {
              document.querySelectorAll('.sppd-approve').forEach(el => el.style.display = '');
       }
       if (isLaporanApprover) {
              document.querySelectorAll('.sppd-laporan-approve').forEach(el => el.style.display = '');
       }
       if (isPencairanMgr) {
              document.querySelectorAll('.sppd-pencairan-menu').forEach(el => el.style.display = '');
       }
       if (isSppdAll) {
              document.querySelectorAll('.sppd-all').forEach(el => el.style.display = '');
       }
}

// ===================== NAVIGATION =====================
function showLogin() {
       document.getElementById('page-login').style.display = '';
       document.getElementById('page-app').style.display = 'none';
}

function showApp() {
       document.getElementById('page-login').style.display = 'none';
       document.getElementById('page-app').style.display = 'flex';
}

function showPage(page) {
       document.querySelectorAll('.content-page').forEach(el => el.style.display = 'none');
       document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
       const target = document.getElementById(`content-${page}`);
       if (target) target.style.display = '';
       const menuItem = document.querySelector(`[data-page="${page}"]`);
       if (menuItem) menuItem.classList.add('active');
       const titles = {
              'dashboard': 'Dashboard',
              'new-submission': 'Buat Pengajuan Baru',
              'my-submissions': 'Pengajuan Saya',
              'admin-submissions': 'Semua Pengajuan',
              'admin-users': 'Kelola Pengguna',
              'admin-settings': 'Pengaturan',
              'new-kk': 'Buat Kertas Kerja',
              'my-kk': 'Kertas Kerja Saya',
              'kk-approvals': 'Persetujuan Kertas Kerja',
              'admin-kk': 'Semua Kertas Kerja',
              'new-sppd': 'Buat SPPD Baru',
              'my-sppd': 'SPPD Saya',
              'sppd-approvals': 'Persetujuan SPPD',
              'sppd-laporan-approvals': 'Persetujuan Laporan',
              'sppd-pencairan': 'Pencairan Dana SPPD',
              'admin-sppd': 'Semua SPPD',
              'profile': 'Profil Saya',
       };
       document.getElementById('top-bar-title').textContent = titles[page] || page;
       if (page === 'dashboard') loadDashboard();
       else if (page === 'new-submission') initNewSubmission();
       else if (page === 'my-submissions') loadMySubmissions();
       else if (page === 'admin-submissions') loadAdminSubmissions();
       else if (page === 'admin-users') loadUsers();
       else if (page === 'admin-settings') loadSettings();
       else if (page === 'new-kk') initKKForm();
       else if (page === 'my-kk') loadMyKK();
       else if (page === 'kk-approvals') loadKKApprovals();
       else if (page === 'admin-kk') loadAdminKK();
       else if (page === 'new-sppd') initSPPDForm();
       else if (page === 'my-sppd') loadMySPPD();
       else if (page === 'sppd-approvals') loadSPPDApprovals();
       else if (page === 'sppd-laporan-approvals') loadLaporanApprovals();
       else if (page === 'sppd-pencairan') loadPencairan();
       else if (page === 'admin-sppd') loadAdminSPPD();
       else if (page === 'profile') loadProfile();
       if (window.innerWidth <= 768) {
              document.getElementById('sidebar').classList.remove('open');
       }
       return false;
}

function toggleSidebar() {
       document.getElementById('sidebar').classList.toggle('open');
}

// ===================== DASHBOARD =====================
async function loadDashboard() {
       try {
              if (currentUser.role === 'admin' || currentUser.role === 'kantor_pusat') {
                     await loadDashboardAdmin();
              } else {
                     await loadDashboardStaff();
              }
              const hasSppdAccess = SPPD_ALL_ROLES.includes(currentUser.role) || SPPD_CREATE_ROLES.includes(currentUser.role);
              if (hasSppdAccess) await loadSppdDashboard();
       } catch (e) {
              console.error(e);
       }
}

async function loadDashboardAdmin() {
       const month = document.getElementById('dash-filter-month')?.value || '';
       const url = '/api/submissions/dashboard-stats' + (month ? '?month=' + month : '');
       const res = await api(url);
       const data = await res.json();
       const { summary, per_user, available_months } = data;

       populateDashMonthFilter(available_months, month);

       document.getElementById('stat-total').textContent = summary.total;
       document.getElementById('stat-pending').textContent = summary.menunggu;
       document.getElementById('stat-approved').textContent = summary.disetujui;
       document.getElementById('stat-rejected').textContent = summary.ditolak;
       document.getElementById('stat-products').textContent = summary.jumlah_produk;
       document.getElementById('stat-clients').textContent = summary.jumlah_pelanggan;

       const zipBtn = document.getElementById('btn-download-zip');
       if (zipBtn) zipBtn.style.display = (month && summary.disetujui > 0) ? '' : 'none';

       const card = document.getElementById('card-per-user');
       const container = document.getElementById('per-user-stats');
       card.style.display = '';
       const activeUsers = per_user.filter(u => u.total > 0);
       if (activeUsers.length === 0) {
              container.innerHTML = emptyState('Belum ada data pengajuan');
       } else {
              const rows = activeUsers.map(u => `<tr>
                  <td><div style="font-weight:600">${escHtml(u.full_name)}</div><div style="font-size:11px;color:var(--text-light)">${escHtml(u.username)}</div></td>
                  <td class="text-center fw-bold">${u.total}</td>
                  <td class="text-center"><span class="badge badge-approved">${u.disetujui}</span></td>
                  <td class="text-center"><span class="badge badge-rejected">${u.ditolak}</span></td>
                  <td class="text-center"><span class="badge badge-pending">${u.menunggu}</span></td>
                  <td class="text-center">${u.jumlah_produk}</td>
                  <td class="text-center">${u.jumlah_pelanggan}</td>
            </tr>`).join('');
              container.innerHTML = `<div class="table-responsive"><table class="table">
                  <thead><tr>
                        <th>Akun</th>
                        <th class="text-center">Total</th>
                        <th class="text-center">Disetujui</th>
                        <th class="text-center">Ditolak</th>
                        <th class="text-center">Menunggu</th>
                        <th class="text-center">Produk</th>
                        <th class="text-center">Pelanggan</th>
                  </tr></thead>
                  <tbody>${rows}</tbody>
            </table></div>`;
       }

       const subsRes = await api('/api/submissions');
       const allSubs = await subsRes.json();
       const filtered = month ? allSubs.filter(s => s.created_at && s.created_at.startsWith(month)) : allSubs;
       const recent = filtered.slice(0, 5);
       const recentEl = document.getElementById('recent-submissions');
       recentEl.innerHTML = recent.length === 0 ? emptyState('Belum ada pengajuan') : renderSubmissionTable(recent, false);
}

async function loadDashboardStaff() {
       const res = await api('/api/submissions');
       const submissions = await res.json();

       const monthsSet = new Set();
       submissions.forEach(s => { if (s.created_at) monthsSet.add(s.created_at.substring(0, 7)); });
       const availableMonths = Array.from(monthsSet).sort().reverse();
       populateDashMonthFilter(availableMonths, document.getElementById('dash-filter-month')?.value || '');

       const month = document.getElementById('dash-filter-month')?.value || '';
       const filtered = month ? submissions.filter(s => s.created_at && s.created_at.startsWith(month)) : submissions;

       const total = filtered.length;
       const pending = filtered.filter(s => s.status === 'pending').length;
       const approved = filtered.filter(s => s.status === 'approved').length;
       const rejected = filtered.filter(s => s.status === 'rejected').length;
       let produk = 0;
       const pelSet = new Set();
       filtered.forEach(s => {
              const items = Array.isArray(s.items) ? s.items : [];
              produk += items.length;
              if (s.client_name) pelSet.add(s.client_name);
       });

       document.getElementById('stat-total').textContent = total;
       document.getElementById('stat-pending').textContent = pending;
       document.getElementById('stat-approved').textContent = approved;
       document.getElementById('stat-rejected').textContent = rejected;
       document.getElementById('stat-products').textContent = produk;
       document.getElementById('stat-clients').textContent = pelSet.size;

       const card = document.getElementById('card-per-user');
       if (card) card.style.display = 'none';
       const zipBtn = document.getElementById('btn-download-zip');
       if (zipBtn) zipBtn.style.display = 'none';

       const recent = filtered.slice(0, 5);
       const recentEl = document.getElementById('recent-submissions');
       recentEl.innerHTML = recent.length === 0 ? emptyState('Belum ada pengajuan') : renderSubmissionTable(recent, false);
}

function populateDashMonthFilter(availableMonths, selectedMonth) {
       const sel = document.getElementById('dash-filter-month');
       if (!sel) return;
       const opts = ['<option value="">Semua Bulan</option>'];
       (availableMonths || []).forEach(m => {
              const [yr, mo] = m.split('-');
              const label = new Date(parseInt(yr), parseInt(mo) - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
              opts.push(`<option value="${m}"${m === selectedMonth ? ' selected' : ''}>${label}</option>`);
       });
       sel.innerHTML = opts.join('');
}

async function loadSppdDashboard() {
       const sel = document.getElementById('sppd-dash-filter-month');
       const month = sel?.value || '';
       const url = '/api/sppd/dashboard-stats' + (month ? '?month=' + month : '');
       try {
              const res = await api(url);
              if (!res.ok) return;
              const { summary, per_user, available_months } = await res.json();

              // Populate month filter
              if (sel) {
                     const opts = ['<option value="">Semua Bulan</option>'];
                     (available_months || []).forEach(m => {
                            const [yr, mo] = m.split('-');
                            const label = new Date(parseInt(yr), parseInt(mo) - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                            opts.push(`<option value="${m}"${m === month ? ' selected' : ''}>${label}</option>`);
                     });
                     sel.innerHTML = opts.join('');
              }

              document.getElementById('sppd-stat-total').textContent = summary.total || 0;
              document.getElementById('sppd-stat-aktif').textContent = summary.aktif || 0;
              document.getElementById('sppd-stat-selesai').textContent = summary.selesai || 0;
              document.getElementById('sppd-stat-laporan').textContent = summary.jumlah_laporan || 0;
              document.getElementById('sppd-stat-biaya-usulan').textContent = 'Rp ' + formatRupiahShort(summary.total_biaya_usulan || 0);
              document.getElementById('sppd-stat-biaya-cair').textContent = 'Rp ' + formatRupiahShort(summary.total_biaya_dicairkan || 0);

              const section = document.getElementById('sppd-dashboard-section');
              if (section) section.style.display = '';

              const cardPerUser = document.getElementById('sppd-card-per-user');
              const container = document.getElementById('sppd-per-user-stats');
              if (cardPerUser && container) {
                     const showPerUser = SPPD_ALL_ROLES.includes(currentUser.role);
                     if (showPerUser && per_user && per_user.length > 0) {
                            cardPerUser.style.display = '';
                            const rows = per_user.map(u => `<tr>
                                   <td><div style="font-weight:600">${escHtml(u.full_name)}</div><div style="font-size:11px;color:var(--text-light)">${escHtml(u.area_kerja || u.username)}</div></td>
                                   <td class="text-center fw-bold">${u.total}</td>
                                   <td class="text-center"><span class="badge badge-pending">${u.aktif}</span></td>
                                   <td class="text-center"><span class="badge badge-approved">${u.selesai}</span></td>
                                   <td class="text-right">${u.total_biaya_usulan > 0 ? 'Rp ' + formatRupiah(u.total_biaya_usulan) : '-'}</td>
                                   <td class="text-right">${u.total_biaya_dicairkan > 0 ? 'Rp ' + formatRupiah(u.total_biaya_dicairkan) : '-'}</td>
                            </tr>`).join('');
                            container.innerHTML = `<div class="table-responsive"><table class="table">
                                   <thead><tr>
                                          <th>Pegawai</th>
                                          <th class="text-center">Total</th>
                                          <th class="text-center">Aktif</th>
                                          <th class="text-center">Selesai</th>
                                          <th class="text-right">Biaya Usulan</th>
                                          <th class="text-right">Dicairkan</th>
                                   </tr></thead>
                                   <tbody>${rows}</tbody>
                            </table></div>`;
                     } else {
                            cardPerUser.style.display = 'none';
                     }
              }
       } catch (e) {
              console.error('SPPD dashboard error:', e);
       }
}

async function downloadZip() {
       const month = document.getElementById('dash-filter-month')?.value;
       if (!month) { showToast('Pilih bulan terlebih dahulu', 'error'); return; }
       showToast('⏳ Menyiapkan ZIP... Harap tunggu', '');
       try {
              const res = await fetch(`/api/submissions/bulk-pdf-zip?month=${month}`);
              if (!res.ok) {
                     const data = await res.json();
                     showToast(data.error || 'Gagal membuat ZIP', 'error');
                     return;
              }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const [yr, mo] = month.split('-');
              const a = document.createElement('a');
              a.href = url; a.download = `SPH_${yr}_${mo}.zip`; a.click();
              URL.revokeObjectURL(url);
              showToast('✅ ZIP berhasil diunduh!', 'success');
       } catch {
              showToast('Gagal mengunduh ZIP', 'error');
       }
}

// ===================== SUBMISSION LIST =====================
async function loadMySubmissions() {
       const container = document.getElementById('my-submissions-list');
       container.innerHTML = '<div class="loading">⏳ Memuat data...</div>';
       try {
              const res = await api('/api/submissions');
              const submissions = await res.json();
              if (submissions.length === 0) {
                     container.innerHTML = emptyState('Belum ada pengajuan. Klik "+ Buat Pengajuan" untuk memulai.');
              } else {
                     container.innerHTML = renderSubmissionTable(submissions, true);
              }
       } catch (e) {
              container.innerHTML = '<div class="alert alert-error">Gagal memuat data</div>';
       }
}

async function loadAdminSubmissions() {
       const container = document.getElementById('admin-submissions-list');
       container.innerHTML = '<div class="loading">⏳ Memuat data...</div>';
       const filterStatus = document.getElementById('filter-status')?.value || '';
       try {
              const res = await api('/api/submissions');
              let submissions = await res.json();
              if (filterStatus) {
                     submissions = submissions.filter(s => s.status === filterStatus);
              }
              if (submissions.length === 0) {
                     container.innerHTML = emptyState('Tidak ada pengajuan' + (filterStatus ? ` dengan status "${filterStatus}"` : ''));
              } else {
                     container.innerHTML = renderSubmissionTable(submissions, true, true);
              }
       } catch (e) {
              container.innerHTML = '<div class="alert alert-error">Gagal memuat data</div>';
       }
}

function renderSubmissionTable(submissions, showActions = false, isAdmin = false) {
       const rows = submissions.map(s => {
              const items = Array.isArray(s.items) ? s.items : [];
              const total = items.reduce((sum, i) => sum + (parseFloat(i.qty) || 0) * (parseFloat(i.harga_satuan) || 0), 0);
              return `<tr>
                  <td>
                          <div style="font-weight:600">${escHtml(s.client_name)}</div>
                                  <div style="font-size:12px;color:var(--text-light)">${s.nomor ? `No: ${escHtml(s.nomor)}` : 'Belum bernomor'}</div>
                                        </td>
                                              ${isAdmin ? `<td style="font-size:12px">${escHtml(s.creator_name || '-')}</td>` : ''}
                                                    <td>${items.length} produk</td>
                                                          <td style="font-weight:600">Rp ${formatRupiah(total)}</td>
                                                                <td><span class="badge badge-${s.status}">${statusLabel(s.status)}</span></td>
                                                                      <td style="font-size:12px;color:var(--text-light)">${formatDate(s.created_at)}</td>
                                                                            <td>
                                                                                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                                                                                              <button onclick="viewDetail(${s.id})" class="btn btn-secondary btn-sm">🔍 Detail</button>
                                                                                                        ${s.status === 'approved' ? `
                                                                                                                    <div class="download-group">
                                                                                                                                  ${(currentUser.role === 'admin' || currentUser.role === 'kantor_pusat') ? `<button onclick="downloadDoc(${s.id},'docx')" class="btn btn-success btn-sm" title="Unduh Word">⬇️ Word</button>` : ''}
                                                                                                                                                <button onclick="downloadDoc(${s.id},'pdf')" class="btn btn-pdf btn-sm" title="Unduh PDF">📄 PDF</button>
                                                                                                                                                            </div>` : ''}
                                                                                                                                                                      ${isAdmin && s.status === 'pending' ? `
                                                                                                                                                                                  <button onclick="approveSubmission(${s.id})" class="btn btn-success btn-sm">✅ Setuju</button>
                                                                                                                                                                                              <button onclick="openRejectModal(${s.id})" class="btn btn-danger btn-sm">❌ Tolak</button>
                                                                                                                                                                                                        ` : ''}
                                                                                                                                                                                                                          ${s.status === 'pending' && showActions && (currentUser.role === 'admin' || s.created_by === currentUser.id) ? `
                                                                                                                                                                                                                                  <button onclick="openEditModal(${s.id})" class="btn btn-secondary btn-sm">✏️ Edit</button>
                                                                                                                                                                                                                                  <button onclick="deleteSubmission(${s.id})" class="btn btn-danger btn-sm">🗑️ Hapus</button>
                                                                                                                                                                                                                                ` : ''}
                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                      </td>
                                                                                                                                                                                                                          </tr>`;
       }).join('');
       return `<div class="table-responsive">
         <table class="table">
               <thead>
                       <tr>
                                 <th>Klien / Instansi</th>
                                           ${isAdmin ? '<th>Dibuat Oleh</th>' : ''}
                                                     <th>Produk</th>
                                                               <th>Total</th>
                                                                         <th>Status</th>
                                                                                   <th>Tanggal</th>
                                                                                             <th>Aksi</th>
                                                                                                     </tr>
                                                                                                           </thead>
                                                                                                                 <tbody>${rows}</tbody>
                                                                                                                     </table>
                                                                                                                       </div>`;
}

// ===================== VIEW DETAIL =====================
async function viewDetail(id) {
       try {
              const res = await api(`/api/submissions/${id}`);
              const s = await res.json();
              const items = Array.isArray(s.items) ? s.items : [];
              const total = items.reduce((sum, i) => sum + (parseFloat(i.qty) || 0) * (parseFloat(i.harga_satuan) || 0), 0);
              document.getElementById('modal-detail-title').textContent = `Detail SPH - ${s.client_name}`;
              const itemRows = items.map((item, idx) => {
                     const itemTotal = (parseFloat(item.qty) || 0) * (parseFloat(item.harga_satuan) || 0);
                     return `<tr>
                             <td class="text-center">${idx + 1}</td>
                                     <td><strong>${escHtml(item.nama_produk)}</strong></td>
                                             <td>${escHtml(item.pabrikan || '-')}</td>
                                                     <td>${escHtml(item.spesifikasi || '-')}</td>
                                                             <td class="text-center">${item.qty}</td>
                                                                     <td class="text-center">${item.satuan || '-'}</td>
                                                                             <td class="text-right">Rp ${formatRupiah(item.harga_satuan)}</td>
                                                                                     <td class="text-right">Rp ${formatRupiah(itemTotal)}</td>
                                                                                             <td class="text-center">${item.link ? `<a href="${escHtml(item.link)}" target="_blank" class="btn btn-secondary btn-sm">🔗 Link</a>` : '-'}</td>
                                                                                                   </tr>`;
              }).join('');
              document.getElementById('modal-detail-body').innerHTML = `
                  <div class="detail-grid">
                          <div class="detail-item">
                                    <label>Status</label>
                                              <div class="value"><span class="badge badge-${s.status}">${statusLabel(s.status)}</span></div>
                                                      </div>
                                                              <div class="detail-item">
                                                                        <label>Nomor Surat</label>
                                                                                  <div class="value">${s.nomor || '—'}</div>
                                                                                          </div>
                                                                                                  <div class="detail-item">
                                                                                                            <label>Klien / Instansi</label>
                                                                                                                      <div class="value">${escHtml(s.client_name)}</div>
                                                                                                                              </div>
                                                                                                                                      <div class="detail-item">
                                                                                                                                                <label>Jabatan</label>
                                                                                                                                                          <div class="value">${escHtml(s.client_title || '-')}</div>
                                                                                                                                                                  </div>
                                                                                                                                                                          <div class="detail-item" style="grid-column:1/-1">
                                                                                                                                                                                    <label>Alamat</label>
                                                                                                                                                                                              <div class="value">${escHtml(s.client_address)}, ${escHtml(s.client_city || 'di Tempat')}</div>
                                                                                                                                                                                                      </div>
                                                                                                                                                                                                              <div class="detail-item">
                                                                                                                                                                                                                        <label>Dibuat Oleh</label>
                                                                                                                                                                                                                                  <div class="value">${escHtml(s.creator_name || '-')}</div>
                                                                                                                                                                                                                                          </div>
                                                                                                                                                                                                                                                  <div class="detail-item">
                                                                                                                                                                                                                                                            <label>Tanggal Pengajuan</label>
                                                                                                                                                                                                                                                                      <div class="value">${formatDate(s.created_at)}</div>
                                                                                                                                                                                                                                                                              </div>
                                                                                                                                                                                                                                                                                      ${s.status === 'approved' ? `
                                                                                                                                                                                                                                                                                                <div class="detail-item">
                                                                                                                                                                                                                                                                                                            <label>Disetujui Oleh</label>
                                                                                                                                                                                                                                                                                                                        <div class="value">${escHtml(s.approver_name || '-')}</div>
                                                                                                                                                                                                                                                                                                                                  </div>
                                                                                                                                                                                                                                                                                                                                            <div class="detail-item">
                                                                                                                                                                                                                                                                                                                                                        <label>Tanggal Persetujuan</label>
                                                                                                                                                                                                                                                                                                                                                                    <div class="value">${formatDate(s.approved_at)}</div>
                                                                                                                                                                                                                                                                                                                                                                              </div>` : ''}
                                                                                                                                                                                                                                                                                                                                                                                      ${s.status === 'rejected' ? `
                                                                                                                                                                                                                                                                                                                                                                                                <div class="detail-item" style="grid-column:1/-1">
                                                                                                                                                                                                                                                                                                                                                                                                            <label>Alasan Penolakan</label>
                                                                                                                                                                                                                                                                                                                                                                                                                        <div class="value" style="color:var(--red)">${escHtml(s.reject_reason || '-')}</div>
                                                                                                                                                                                                                                                                                                                                                                                                                                  </div>` : ''}
                                                                                                                                                                                                                                                                                                                                                                                                                                        </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                              <div class="detail-section-title">🏷️ Daftar Produk</div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                    <div class="table-responsive">
                                                                                                                                                                                                                                                                                                                                                                                                                                                            <table class="table">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                      <thead>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  <tr>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                <th>No</th><th>Nama Produk</th><th>Pabrikan</th><th>Spesifikasi</th>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <th>Qty</th><th>Satuan</th><th>Harga Satuan</th><th>Total</th><th>Link</th>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          </tr>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    </thead>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <tbody>${itemRows}</tbody>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        <tfoot>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    <tr>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  <td colspan="7" class="text-right fw-bold">TOTAL</td>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                <td class="text-right fw-bold">Rp ${formatRupiah(total)}</td>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <td></td>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          </tr>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    </tfoot>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            </table>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  </div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        <div class="detail-section-title">📋 Kondisi Penawaran</div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <ul style="list-style:disc;padding-left:20px;line-height:2">
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      <li>Harga <strong>${s.ppn_included ? 'sudah' : 'belum'}</strong> termasuk PPN</li>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              <li>Harga <strong>${s.ongkir_included ? 'sudah' : 'belum'}</strong> termasuk ongkos kirim</li>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      ${s.notes ? `<li>${escHtml(s.notes)}</li>` : ''}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            </ul>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                `;
              const _canApprove = currentUser.role === 'admin' || currentUser.role === 'kantor_pusat';
              let footerHTML = '';
              if (s.status === 'approved') {
                     if (_canApprove) {
                            footerHTML += `<button onclick="downloadDoc(${s.id},'docx')" class="btn btn-success">⬇️ Unduh Word</button>`;
                     }
                     footerHTML += `<button onclick="downloadDoc(${s.id},'pdf')" class="btn btn-pdf">📄 Unduh PDF</button>`;
              }
              if (_canApprove && s.status === 'pending') {
                     footerHTML += `<button onclick="approveSubmission(${s.id})" class="btn btn-success">✅ Setujui</button>`;
                     footerHTML += `<button onclick="openRejectModal(${s.id})" class="btn btn-danger">❌ Tolak</button>`;
              }
              if (s.status === 'pending' && (currentUser.role === 'admin' || s.created_by === currentUser.id)) {
                     footerHTML += `<button onclick="closeModal('modal-detail');setTimeout(()=>openEditModal(${s.id}),200)" class="btn btn-secondary">✏️ Edit</button>`;
                     footerHTML += `<button onclick="deleteSubmission(${s.id})" class="btn btn-danger">🗑️ Hapus</button>`;
              }
              footerHTML += `<button onclick="closeModal('modal-detail')" class="btn btn-outline">Tutup</button>`;
              document.getElementById('modal-detail-footer').innerHTML = footerHTML;
              showModal('modal-detail');
       } catch (e) {
              showToast('Gagal memuat detail', 'error');
       }
}

// ===================== NEW SUBMISSION =====================
function initNewSubmission() {
       document.getElementById('form-submission').reset();
       document.getElementById('sub-client-city').value = 'di Tempat';
       document.getElementById('submit-error').style.display = 'none';
       document.getElementById('submit-success').style.display = 'none';
       productRowCount = 0;
       document.getElementById('product-tbody').innerHTML = '';
       document.getElementById('grand-total').textContent = 'Rp 0';
       addProductRow();
}

function addProductRow() {
       productRowCount++;
       const idx = productRowCount;
       const tbody = document.getElementById('product-tbody');
       const tr = document.createElement('tr');
       tr.id = `row-${idx}`;
       tr.innerHTML = `
         <td class="text-center" style="color:var(--text-light)">${idx}</td>
             <td><input type="text"   class="table-input"        placeholder="Nama produk"  data-field="nama_produk"  oninput="updateTotal()"></td>
                 <td><input type="text"   class="table-input"        placeholder="Pabrikan"     data-field="pabrikan"></td>
                     <td><input type="text"   class="table-input"        placeholder="Spesifikasi"  data-field="spesifikasi"></td>
                         <td><input type="number" class="table-input small"  placeholder="0" min="0"   data-field="qty"          oninput="updateTotal()"></td>
                             <td><input type="text"   class="table-input"        placeholder="unit"         data-field="satuan"       style="width:70px"></td>
                                 <td><input type="number" class="table-input medium" placeholder="0" min="0"   data-field="harga_satuan" oninput="updateTotal()"></td>
                                     <td class="text-right fw-bold row-total">Rp 0</td>
                                         <td><input type="url"    class="table-input"        placeholder="https://..."  data-field="link"         style="width:180px"></td>
                                             <td><button type="button" onclick="removeRow(${idx})" class="btn-remove-row" title="Hapus baris">×</button></td>
                                               `;
       tbody.appendChild(tr);
       tr.querySelector('input').focus();
}

function removeRow(idx) {
       const row = document.getElementById(`row-${idx}`);
       if (row) {
              row.remove();
              Array.from(document.querySelectorAll('#product-tbody tr')).forEach((tr, i) => {
                     tr.cells[0].textContent = i + 1;
              });
              updateTotal();
       }
}

function updateTotal() {
       let grand = 0;
       document.querySelectorAll('#product-tbody tr').forEach(tr => {
              const qty = parseFloat(tr.querySelector('[data-field="qty"]')?.value) || 0;
              const harga = parseFloat(tr.querySelector('[data-field="harga_satuan"]')?.value) || 0;
              const total = qty * harga;
              grand += total;
              tr.querySelector('.row-total').textContent = 'Rp ' + formatRupiah(total);
       });
       document.getElementById('grand-total').textContent = 'Rp ' + formatRupiah(grand);
}

document.getElementById('form-submission').addEventListener('submit', async (e) => {
       e.preventDefault();
       const errEl = document.getElementById('submit-error');
       const okEl = document.getElementById('submit-success');
       errEl.style.display = 'none';
       okEl.style.display = 'none';
       const items = [];
       let valid = true;
       document.querySelectorAll('#product-tbody tr').forEach(tr => {
              const item = {
                     nama_produk: tr.querySelector('[data-field="nama_produk"]')?.value?.trim() || '',
                     pabrikan: tr.querySelector('[data-field="pabrikan"]')?.value?.trim() || '',
                     spesifikasi: tr.querySelector('[data-field="spesifikasi"]')?.value?.trim() || '',
                     qty: tr.querySelector('[data-field="qty"]')?.value || '0',
                     satuan: tr.querySelector('[data-field="satuan"]')?.value?.trim() || '',
                     harga_satuan: tr.querySelector('[data-field="harga_satuan"]')?.value || '0',
                     link: tr.querySelector('[data-field="link"]')?.value?.trim() || '',
              };
              if (!item.nama_produk) { valid = false; return; }
              items.push(item);
       });
       if (!valid || items.length === 0) {
              errEl.textContent = 'Harap isi nama produk untuk semua baris, atau hapus baris yang kosong.';
              errEl.style.display = 'block';
              return;
       }
       const payload = {
              client_title: document.getElementById('sub-client-title').value.trim(),
              client_name: document.getElementById('sub-client-name').value.trim(),
              client_address: document.getElementById('sub-client-address').value.trim(),
              client_city: document.getElementById('sub-client-city').value.trim() || 'di Tempat',
              items,
              ppn_included: document.querySelector('input[name="ppn"]:checked')?.value === '1',
              ongkir_included: document.querySelector('input[name="ongkir"]:checked')?.value === '1',
              notes: document.getElementById('sub-notes').value.trim(),
              lampiran: document.getElementById('sub-lampiran').value.trim(),
       };
       try {
              const submitBtn = e.target.querySelector('button[type="submit"]');
              submitBtn.disabled = true;
              submitBtn.textContent = '⏳ Mengirim...';
              const res = await api('/api/submissions', 'POST', payload);
              const data = await res.json();
              submitBtn.disabled = false;
              submitBtn.textContent = '📤 Kirim Pengajuan';
              if (res.ok) {
                     okEl.textContent = '✅ Pengajuan berhasil dikirim! Admin akan mereview dan menyetujui pengajuan Anda.';
                     okEl.style.display = 'block';
                     showToast('Pengajuan berhasil dikirim!', 'success');
                     setTimeout(() => showPage('my-submissions'), 2000);
              } else {
                     errEl.textContent = data.error || 'Gagal mengirim pengajuan';
                     errEl.style.display = 'block';
              }
       } catch (err) {
              errEl.textContent = 'Koneksi ke server gagal';
              errEl.style.display = 'block';
       }
});

// ===================== APPROVE / REJECT =====================
async function approveSubmission(id) {
       if (!confirm('Setujui pengajuan ini? Nomor surat akan otomatis dibuat.')) return;
       try {
              const res = await api(`/api/submissions/${id}/approve`, 'POST');
              const data = await res.json();
              if (res.ok) {
                     showToast(`✅ Disetujui! No: ${data.nomor}`, 'success');
                     closeModal('modal-detail');
                     const activePage = document.querySelector('.menu-item.active')?.getAttribute('data-page');
                     if (activePage) showPage(activePage); else loadDashboard();
              } else {
                     showToast(data.error || 'Gagal menyetujui', 'error');
              }
       } catch {
              showToast('Koneksi gagal', 'error');
       }
}

function openRejectModal(id) {
       rejectTargetId = id;
       document.getElementById('reject-reason').value = '';
       closeModal('modal-detail');
       setTimeout(() => showModal('modal-reject'), 200);
}

async function confirmReject() {
       const reason = document.getElementById('reject-reason').value.trim();
       if (!reason) { showToast('Harap isi alasan penolakan', 'error'); return; }
       try {
              const res = await api(`/api/submissions/${rejectTargetId}/reject`, 'POST', { reason });
              const data = await res.json();
              if (res.ok) {
                     showToast('Pengajuan ditolak', 'success');
                     closeModal('modal-reject');
                     const activePage = document.querySelector('.menu-item.active')?.getAttribute('data-page');
                     if (activePage) showPage(activePage);
              } else {
                     showToast(data.error || 'Gagal menolak', 'error');
              }
       } catch {
              showToast('Koneksi gagal', 'error');
       }
}

// ===================== DOWNLOAD =====================
async function downloadDoc(id, format = 'docx') {
       const label = format === 'pdf' ? 'PDF' : 'Word';
       showToast(`⏳ Membuat ${label}...`, '');
       try {
              const url = format === 'pdf'
                     ? `/api/submissions/${id}/download/pdf`
                     : `/api/submissions/${id}/download`;
              const res = await fetch(url);
              if (!res.ok) {
                     const data = await res.json();
                     showToast(data.error || 'Gagal mengunduh', 'error');
                     return;
              }
              const blob = await res.blob();
              const objUrl = URL.createObjectURL(blob);
              const ext = format === 'pdf' ? '.pdf' : '.docx';
              const filename = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]
                     || `SPH_${id}${ext}`;
              const a = document.createElement('a');
              a.href = objUrl;
              a.download = filename;
              a.click();
              URL.revokeObjectURL(objUrl);
              showToast(`✅ ${label} berhasil diunduh!`, 'success');
       } catch (e) {
              showToast('Gagal mengunduh dokumen', 'error');
       }
}

// ===================== USERS =====================
async function loadUsers() {
       const container = document.getElementById('users-list');
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       try {
              const res = await api('/api/submissions/meta/users');
              const users = await res.json();
              const rows = users.map(u => `
                  <tr>
                          <td>${escHtml(u.username)}</td>
                          <td>${escHtml(u.full_name)}</td>
                          <td><span class="badge ${u.role === 'admin' ? 'badge-approved' : u.role === 'kantor_pusat' ? 'badge-info' : 'badge-pending'}">${ROLE_LABELS[u.role] || u.role}</span></td>
                          <td style="font-size:12px;color:var(--text-light)">${escHtml(u.area_kerja || '-')}</td>
                          <td>
                                <div style="display:flex;gap:6px;flex-wrap:wrap">
                                        <button onclick="openEditUserModal(${u.id},'${escHtml(u.username)}','${escHtml(u.full_name)}','${u.role}','${escHtml(u.area_kerja || '')}','${escHtml(u.jabatan_detail || '')}')" class="btn btn-secondary btn-sm">✏️ Edit</button>
                                        <button onclick="openResetPasswordModal(${u.id}, '${escHtml(u.full_name)}')" class="btn btn-secondary btn-sm">🔑 Reset</button>
                                        ${u.id !== currentUser.id
                            ? `<button onclick="deleteUser(${u.id}, '${escHtml(u.full_name)}')" class="btn btn-danger btn-sm">🗑️ Hapus</button>`
                            : ''}
                                </div>
                          </td>
                  </tr>`).join('');
              container.innerHTML = `<div class="table-responsive">
                  <table class="table">
                          <thead><tr><th>Username</th><th>Nama</th><th>Role</th><th>Area Kerja</th><th>Aksi</th></tr></thead>
                          <tbody>${rows}</tbody>
                  </table></div>`;
       } catch {
              container.innerHTML = '<div class="alert alert-error">Gagal memuat data</div>';
       }
}

function openAddUserModal() {
       document.getElementById('add-user-modal-title').textContent = 'Tambah Pengguna Baru';
       document.getElementById('new-username').value = '';
       document.getElementById('new-username').disabled = false;
       document.getElementById('new-password').value = '';
       document.getElementById('new-password').placeholder = 'Password';
       document.getElementById('new-fullname').value = '';
       document.getElementById('new-role').value = 'staff';
       document.getElementById('new-area-kerja').value = '';
       document.getElementById('new-jabatan-detail').value = '';
       document.getElementById('edit-user-id').value = '';
       document.getElementById('add-user-error').style.display = 'none';
       showModal('modal-add-user');
}

function openEditUserModal(id, username, fullName, role, areaKerja, jabatanDetail) {
       document.getElementById('add-user-modal-title').textContent = 'Edit Pengguna';
       document.getElementById('new-username').value = username;
       document.getElementById('new-username').disabled = true;
       document.getElementById('new-password').value = '';
       document.getElementById('new-password').placeholder = 'Kosongkan jika tidak diubah';
       document.getElementById('new-fullname').value = fullName;
       document.getElementById('new-role').value = role;
       document.getElementById('new-area-kerja').value = areaKerja;
       document.getElementById('new-jabatan-detail').value = jabatanDetail;
       document.getElementById('edit-user-id').value = id;
       document.getElementById('add-user-error').style.display = 'none';
       showModal('modal-add-user');
}

async function saveUser() {
       const editId = document.getElementById('edit-user-id').value;
       const isEdit = !!editId;
       const username = document.getElementById('new-username').value.trim();
       const password = document.getElementById('new-password').value.trim();
       const full_name = document.getElementById('new-fullname').value.trim();
       const role = document.getElementById('new-role').value;
       const area_kerja = document.getElementById('new-area-kerja').value.trim();
       const jabatan_detail = document.getElementById('new-jabatan-detail').value.trim();
       const errEl = document.getElementById('add-user-error');
       errEl.style.display = 'none';
       if (!full_name || (!isEdit && (!username || !password))) {
              errEl.textContent = isEdit ? 'Nama wajib diisi' : 'Username, password, dan nama wajib diisi';
              errEl.style.display = 'block';
              return;
       }
       try {
              let res;
              if (isEdit) {
                     res = await api(`/api/submissions/meta/users/${editId}`, 'PUT', { full_name, role, area_kerja, jabatan_detail });
                     if (res.ok && password) {
                            await api(`/api/submissions/meta/users/${editId}/password`, 'PUT', { new_password: password });
                     }
              } else {
                     res = await api('/api/submissions/meta/users', 'POST', { username, password, full_name, role, area_kerja, jabatan_detail });
              }
              const data = await res.json();
              if (res.ok) {
                     showToast(isEdit ? 'Pengguna berhasil diperbarui' : 'Pengguna berhasil ditambahkan', 'success');
                     closeModal('modal-add-user');
                     loadUsers();
              } else {
                     errEl.textContent = data.error || 'Gagal';
                     errEl.style.display = 'block';
              }
       } catch {
              errEl.textContent = 'Koneksi gagal';
              errEl.style.display = 'block';
       }
}

async function deleteUser(id, name) {
       if (!confirm(`Hapus pengguna "${name}"?`)) return;
       try {
              const res = await api(`/api/submissions/meta/users/${id}`, 'DELETE');
              if (res.ok) {
                     showToast('Pengguna dihapus', 'success');
                     loadUsers();
              } else {
                     const data = await res.json();
                     showToast(data.error || 'Gagal menghapus', 'error');
              }
       } catch {
              showToast('Koneksi gagal', 'error');
       }
}

// ===================== SETTINGS =====================
async function loadSettings() {
       try {
              const res = await api('/api/submissions/meta/settings');
              const settings = await res.json();
              document.getElementById('set-company-name').value = settings.company_name || '';
              document.getElementById('set-company-tagline').value = settings.company_tagline || '';
              document.getElementById('set-company-address').value = settings.company_address || '';
              document.getElementById('set-company-phone').value = settings.company_phone || '';
              document.getElementById('set-company-email').value = settings.company_email || '';
              document.getElementById('set-company-headoffice').value = settings.company_headoffice || '';
              document.getElementById('set-company-warehouse').value = settings.company_warehouse || '';
              document.getElementById('set-signer-name').value = settings.signer_name || '';
              document.getElementById('set-signer-title').value = settings.signer_title || '';
              document.getElementById('set-nomor-prefix').value = settings.nomor_prefix || '';
              document.getElementById('set-kk-kota').value = settings.kk_kota || '';
              document.getElementById('set-sppd-nomor-prefix').value = settings.sppd_nomor_prefix || '';
              document.getElementById('set-sppd-kota-asal').value = settings.sppd_kota_asal || '';
              const t = Date.now();
              const logoImg = document.getElementById('logo-preview');
              logoImg.style.display = '';
              logoImg.src = `/img/logo.png?t=${t}`;
              const ttdImg = document.getElementById('ttd-preview');
              ttdImg.style.display = '';
              ttdImg.src = `/img/ttd.png?t=${t}`;
       } catch {
              showToast('Gagal memuat pengaturan', 'error');
       }
       loadApproverTTDs();
}

document.getElementById('form-settings').addEventListener('submit', async (e) => {
       e.preventDefault();
       const msgEl = document.getElementById('settings-msg');
       msgEl.style.display = 'none';
       const payload = {
              company_name: document.getElementById('set-company-name').value.trim(),
              company_tagline: document.getElementById('set-company-tagline').value.trim(),
              company_address: document.getElementById('set-company-address').value.trim(),
              company_phone: document.getElementById('set-company-phone').value.trim(),
              company_email: document.getElementById('set-company-email').value.trim(),
              company_headoffice: document.getElementById('set-company-headoffice').value.trim(),
              company_warehouse: document.getElementById('set-company-warehouse').value.trim(),
              signer_name: document.getElementById('set-signer-name').value.trim(),
              signer_title: document.getElementById('set-signer-title').value.trim(),
              nomor_prefix: document.getElementById('set-nomor-prefix').value.trim(),
              kk_kota: document.getElementById('set-kk-kota').value.trim(),
              sppd_nomor_prefix: document.getElementById('set-sppd-nomor-prefix').value.trim(),
              sppd_kota_asal: document.getElementById('set-sppd-kota-asal').value.trim(),
       };
       try {
              const res = await api('/api/submissions/meta/settings', 'PUT', payload);
              if (res.ok) {
                     msgEl.textContent = '✅ Pengaturan berhasil disimpan';
                     msgEl.className = 'alert alert-success';
                     msgEl.style.display = 'block';
                     showToast('Pengaturan disimpan', 'success');
              } else {
                     msgEl.textContent = 'Gagal menyimpan';
                     msgEl.className = 'alert alert-error';
                     msgEl.style.display = 'block';
              }
       } catch {
              showToast('Koneksi gagal', 'error');
       }
});

// ===================== APPROVER TTD =====================
async function loadApproverTTDs() {
       const container = document.getElementById('approver-ttd-list');
       if (!container) return;
       try {
              const res = await api('/api/submissions/meta/users');
              const users = await res.json();
              const t = Date.now();
              if (users.length === 0) {
                     container.innerHTML = '<p style="color:var(--text-light)">Belum ada pengguna.</p>';
                     return;
              }
              container.innerHTML = users.map(u => `
                     <div class="approver-ttd-row">
                            <div class="approver-ttd-info">
                                   <div class="fw-bold">${escHtml(u.full_name)}</div>
                                   <div style="font-size:12px;color:var(--text-light)">${escHtml(u.username)} &mdash; ${ROLE_LABELS[u.role] || u.role}</div>
                            </div>
                            <div class="approver-ttd-preview">
                                   <img id="ttd-u${u.id}-img" src="/img/ttd_u${u.id}.png?t=${t}" alt="TTD"
                                        style="max-height:56px;max-width:110px"
                                        onerror="this.style.display='none';document.getElementById('ttd-u${u.id}-empty').style.display=''">
                                   <span id="ttd-u${u.id}-empty" style="display:none;font-size:12px;color:var(--text-light)">Belum ada TTD</span>
                            </div>
                            <div>
                                   <label class="btn btn-secondary btn-sm" for="ttd-upload-u${u.id}" style="cursor:pointer">📤 Upload</label>
                                   <input type="file" id="ttd-upload-u${u.id}" accept="image/*" style="display:none" onchange="uploadUserTTD(${u.id}, this)">
                                   <div id="ttd-u${u.id}-msg" style="font-size:11px;margin-top:4px"></div>
                            </div>
                     </div>`).join('');
       } catch {
              container.innerHTML = '<div class="alert alert-error">Gagal memuat data pengguna</div>';
       }
}

async function uploadUserTTD(userId, input) {
       const file = input.files[0];
       if (!file) return;
       const msgEl = document.getElementById(`ttd-u${userId}-msg`);
       msgEl.textContent = '⏳ Mengupload...';
       const formData = new FormData();
       formData.append('image', file);
       try {
              const res = await fetch(`/api/submissions/meta/upload/user-ttd/${userId}`, { method: 'POST', body: formData });
              const data = await res.json();
              if (res.ok) {
                     msgEl.textContent = '✅ Berhasil!';
                     const img = document.getElementById(`ttd-u${userId}-img`);
                     const empty = document.getElementById(`ttd-u${userId}-empty`);
                     img.src = data.url;
                     img.style.display = '';
                     if (empty) empty.style.display = 'none';
                     setTimeout(() => { msgEl.textContent = ''; }, 3000);
              } else {
                     msgEl.textContent = '❌ ' + (data.error || 'Gagal upload');
              }
       } catch {
              msgEl.textContent = '❌ Koneksi gagal';
       }
       input.value = '';
}

// ===================== UPLOAD GAMBAR =====================
async function uploadImage(type, input) {
       const file = input.files[0];
       if (!file) return;
       const msgEl = document.getElementById(`${type}-upload-msg`);
       msgEl.textContent = '⏳ Mengupload...';
       msgEl.className = 'alert';
       msgEl.style.display = 'block';
       const formData = new FormData();
       formData.append('image', file);
       try {
              const res = await fetch(`/api/submissions/meta/upload/${type}`, { method: 'POST', body: formData });
              const data = await res.json();
              if (res.ok) {
                     msgEl.textContent = '✅ Berhasil diupload!';
                     msgEl.className = 'alert alert-success';
                     const img = document.getElementById(`${type}-preview`);
                     img.style.display = '';
                     img.src = data.url;
                     const placeholder = document.getElementById(`${type}-placeholder`);
                     if (placeholder) placeholder.style.display = 'none';
              } else {
                     msgEl.textContent = '❌ ' + (data.error || 'Gagal upload');
                     msgEl.className = 'alert alert-error';
              }
       } catch {
              msgEl.textContent = '❌ Koneksi gagal';
              msgEl.className = 'alert alert-error';
       }
       input.value = '';
}

// ===================== EDIT SUBMISSION =====================
async function openEditModal(id) {
       try {
              const res = await api(`/api/submissions/${id}`);
              const s = await res.json();
              if (!res.ok) { showToast(s.error || 'Gagal memuat data', 'error'); return; }
              editTargetId = id;
              editProductRowCount = 0;
              document.getElementById('edit-client-title').value = s.client_title || '';
              document.getElementById('edit-client-name').value = s.client_name || '';
              document.getElementById('edit-client-address').value = s.client_address || '';
              document.getElementById('edit-client-city').value = s.client_city || 'di Tempat';
              const ppnVal = s.ppn_included ? '1' : '0';
              const ongkirVal = s.ongkir_included ? '1' : '0';
              document.querySelector(`input[name="edit-ppn"][value="${ppnVal}"]`).checked = true;
              document.querySelector(`input[name="edit-ongkir"][value="${ongkirVal}"]`).checked = true;
              document.getElementById('edit-lampiran').value = s.lampiran || '';
              document.getElementById('edit-notes').value = s.notes || '';
              document.getElementById('edit-product-tbody').innerHTML = '';
              document.getElementById('edit-grand-total').textContent = 'Rp 0';
              document.getElementById('edit-error').style.display = 'none';
              const items = Array.isArray(s.items) ? s.items : [];
              if (items.length === 0) { addEditProductRow(); } else { items.forEach(item => addEditProductRow(item)); }
              showModal('modal-edit');
       } catch (e) {
              showToast('Gagal memuat data pengajuan', 'error');
       }
}

function addEditProductRow(data = {}) {
       editProductRowCount++;
       const idx = editProductRowCount;
       const tbody = document.getElementById('edit-product-tbody');
       const tr = document.createElement('tr');
       tr.id = `edit-row-${idx}`;
       tr.innerHTML = `
         <td class="text-center" style="color:var(--text-light)">${idx}</td>
             <td><input type="text"   class="table-input"        placeholder="Nama produk"  data-field="nama_produk"  oninput="updateEditTotal()" value="${escHtml(data.nama_produk || '')}"></td>
                 <td><input type="text"   class="table-input"        placeholder="Pabrikan"     data-field="pabrikan"     value="${escHtml(data.pabrikan || '')}"></td>
                     <td><input type="text"   class="table-input"        placeholder="Spesifikasi"  data-field="spesifikasi"  value="${escHtml(data.spesifikasi || '')}"></td>
                         <td><input type="number" class="table-input small"  placeholder="0" min="0"   data-field="qty"          oninput="updateEditTotal()" value="${escHtml(String(data.qty || ''))}"></td>
                             <td><input type="text"   class="table-input"        placeholder="unit"         data-field="satuan"       style="width:70px" value="${escHtml(data.satuan || '')}"></td>
                                 <td><input type="number" class="table-input medium" placeholder="0" min="0"   data-field="harga_satuan" oninput="updateEditTotal()" value="${escHtml(String(data.harga_satuan || ''))}"></td>
                                     <td class="text-right fw-bold row-total">Rp 0</td>
                                         <td><input type="url" class="table-input" placeholder="https://..." data-field="link" style="width:180px" value="${escHtml(data.link || '')}"></td>
                                             <td><button type="button" onclick="removeEditRow(${idx})" class="btn-remove-row" title="Hapus baris">×</button></td>`;
       tbody.appendChild(tr);
       updateEditTotal();
}

function removeEditRow(idx) {
       const row = document.getElementById(`edit-row-${idx}`);
       if (row) {
              row.remove();
              Array.from(document.querySelectorAll('#edit-product-tbody tr')).forEach((tr, i) => {
                     tr.cells[0].textContent = i + 1;
              });
              updateEditTotal();
       }
}

function updateEditTotal() {
       let grand = 0;
       document.querySelectorAll('#edit-product-tbody tr').forEach(tr => {
              const qty = parseFloat(tr.querySelector('[data-field="qty"]')?.value) || 0;
              const harga = parseFloat(tr.querySelector('[data-field="harga_satuan"]')?.value) || 0;
              const total = qty * harga;
              grand += total;
              tr.querySelector('.row-total').textContent = 'Rp ' + formatRupiah(total);
       });
       document.getElementById('edit-grand-total').textContent = 'Rp ' + formatRupiah(grand);
}

async function saveEdit() {
       const errEl = document.getElementById('edit-error');
       errEl.style.display = 'none';
       const items = [];
       let valid = true;
       document.querySelectorAll('#edit-product-tbody tr').forEach(tr => {
              const item = {
                     nama_produk: tr.querySelector('[data-field="nama_produk"]')?.value?.trim() || '',
                     pabrikan: tr.querySelector('[data-field="pabrikan"]')?.value?.trim() || '',
                     spesifikasi: tr.querySelector('[data-field="spesifikasi"]')?.value?.trim() || '',
                     qty: tr.querySelector('[data-field="qty"]')?.value || '0',
                     satuan: tr.querySelector('[data-field="satuan"]')?.value?.trim() || '',
                     harga_satuan: tr.querySelector('[data-field="harga_satuan"]')?.value || '0',
                     link: tr.querySelector('[data-field="link"]')?.value?.trim() || '',
              };
              if (!item.nama_produk) { valid = false; return; }
              items.push(item);
       });
       if (!valid || items.length === 0) {
              errEl.textContent = 'Harap isi nama produk untuk semua baris, atau hapus baris yang kosong.';
              errEl.style.display = 'block';
              return;
       }
       const payload = {
              client_title: document.getElementById('edit-client-title').value.trim(),
              client_name: document.getElementById('edit-client-name').value.trim(),
              client_address: document.getElementById('edit-client-address').value.trim(),
              client_city: document.getElementById('edit-client-city').value.trim() || 'di Tempat',
              items,
              ppn_included: document.querySelector('input[name="edit-ppn"]:checked')?.value === '1',
              ongkir_included: document.querySelector('input[name="edit-ongkir"]:checked')?.value === '1',
              notes: document.getElementById('edit-notes').value.trim(),
              lampiran: document.getElementById('edit-lampiran').value.trim(),
       };
       if (!payload.client_name || !payload.client_address) {
              errEl.textContent = 'Nama instansi dan alamat wajib diisi.';
              errEl.style.display = 'block';
              return;
       }
       try {
              const btn = document.getElementById('btn-save-edit');
              btn.disabled = true;
              btn.textContent = '⏳ Menyimpan...';
              const res = await api(`/api/submissions/${editTargetId}`, 'PUT', payload);
              const data = await res.json();
              btn.disabled = false;
              btn.textContent = '💾 Simpan Perubahan';
              if (res.ok) {
                     showToast('✅ Pengajuan berhasil diperbarui!', 'success');
                     closeModal('modal-edit');
                     const activePage = document.querySelector('.menu-item.active')?.getAttribute('data-page');
                     if (activePage) showPage(activePage); else loadDashboard();
              } else {
                     errEl.textContent = data.error || 'Gagal menyimpan perubahan';
                     errEl.style.display = 'block';
              }
       } catch (err) {
              errEl.textContent = 'Koneksi ke server gagal';
              errEl.style.display = 'block';
       }
}

async function deleteSubmission(id) {
       if (!confirm('Hapus pengajuan ini? Tindakan ini tidak dapat dibatalkan.')) return;
       try {
              const res = await api(`/api/submissions/${id}`, 'DELETE');
              const data = await res.json();
              if (res.ok) {
                     showToast('Pengajuan berhasil dihapus', 'success');
                     closeModal('modal-detail');
                     const activePage = document.querySelector('.menu-item.active')?.getAttribute('data-page');
                     if (activePage) showPage(activePage); else loadDashboard();
              } else {
                     showToast(data.error || 'Gagal menghapus', 'error');
              }
       } catch {
              showToast('Koneksi gagal', 'error');
       }
}

// ===================== KERTAS KERJA =====================
let kkActionTargetId = null;
let kkActionType = null;

function renderKKProductRow(idx) {
       return `<tr>
         <td style="text-align:center;font-size:12px;color:var(--text-light);vertical-align:middle">${idx + 1}</td>
         <td><input type="text" class="table-input kk-prod-nama" placeholder="Nama produk..." oninput="updateKKCalc()"></td>
         <td><input type="number" class="table-input kk-prod-nkt" min="0" placeholder="0" oninput="updateKKCalc()" style="text-align:right"></td>
         <td><input type="number" class="table-input kk-prod-dpp" min="0" placeholder="0" oninput="updateKKCalc()" style="text-align:right"></td>
         <td><input type="number" class="table-input kk-prod-dist" min="0" value="0" oninput="updateKKCalc()" style="text-align:right"></td>
         <td class="kk-pct-display">0%</td>
         <td><input type="number" class="table-input kk-prod-ongkir" min="0" value="0" oninput="updateKKCalc()" style="text-align:right"></td>
         <td class="kk-pct-display">0%</td>
         <td style="text-align:center"><button type="button" onclick="removeKKProduct(this)" class="btn-remove-row" title="Hapus">✕</button></td>
       </tr>`;
}

function addKKProduct() {
       const tbody = document.getElementById('kk-products-tbody');
       const idx = tbody.querySelectorAll('tr').length;
       tbody.insertAdjacentHTML('beforeend', renderKKProductRow(idx));
       updateKKCalc();
}

function removeKKProduct(btn) {
       btn.closest('tr').remove();
       document.querySelectorAll('#kk-products-tbody tr').forEach((r, i) => {
              r.querySelector('td:first-child').textContent = i + 1;
       });
       updateKKCalc();
}

function getKKProductsFromDOM() {
       return Array.from(document.querySelectorAll('#kk-products-tbody tr')).map(row => ({
              nama: row.querySelector('.kk-prod-nama').value.trim(),
              nilai_kontrak: parseFloat(row.querySelector('.kk-prod-nkt').value) || 0,
              dpp_beli: parseFloat(row.querySelector('.kk-prod-dpp').value) || 0,
              b_distribusi: parseFloat(row.querySelector('.kk-prod-dist').value) || 0,
              ongkir: parseFloat(row.querySelector('.kk-prod-ongkir').value) || 0,
       }));
}

function initKKForm() {
       document.getElementById('form-kk').reset();
       document.getElementById('kk-products-tbody').innerHTML = '';
       addKKProduct();
       document.getElementById('kk-form-error').style.display = 'none';
}

function calcKKValues(nkt, dppBeli, bDistribusi, ongkir) {
       const bdo = bDistribusi + ongkir;
       const dppKontrak = nkt / 1.11;
       const ppnKontrak = dppKontrak * 0.11;
       const pphKontrak = dppKontrak * 0.015;
       const penerimaanUang = nkt - (ppnKontrak + pphKontrak);
       const ppnBeli = dppBeli * 0.11;
       const nilaiPembyr = dppBeli * 1.11;
       const surplusDefisit = penerimaanUang - (dppBeli + ppnBeli + bdo);
       const laba = dppKontrak - dppBeli - bdo;
       const bMargin = penerimaanUang > 0 ? (bDistribusi / penerimaanUang) * 100 : 0;
       const ongkirPct = penerimaanUang > 0 ? (ongkir / penerimaanUang) * 100 : 0;
       const netMargin = dppKontrak > 0 ? (laba / dppKontrak) * 100 : 0;
       return { dppKontrak, ppnKontrak, pphKontrak, penerimaanUang, dppBeli, ppnBeli, nilaiPembyr, bDistribusi, ongkir, surplusDefisit, laba, bMargin, ongkirPct, netMargin };
}

function updateKKCalc() {
       const products = getKKProductsFromDOM();
       document.querySelectorAll('#kk-products-tbody tr').forEach((row, i) => {
              const p = products[i];
              const dppK = p.nilai_kontrak / 1.11;
              const pen = p.nilai_kontrak - dppK * 0.11 - dppK * 0.015;
              const pctDist = pen > 0 ? (p.b_distribusi / pen) * 100 : 0;
              const pctOngkir = pen > 0 ? (p.ongkir / pen) * 100 : 0;
              const pcts = row.querySelectorAll('.kk-pct-display');
              if (pcts[0]) pcts[0].textContent = pctDist.toFixed(2) + '%';
              if (pcts[1]) pcts[1].textContent = pctOngkir.toFixed(2) + '%';
       });
       const totNkt = products.reduce((s, p) => s + p.nilai_kontrak, 0);
       const totDpp = products.reduce((s, p) => s + p.dpp_beli, 0);
       const totDist = products.reduce((s, p) => s + p.b_distribusi, 0);
       const totOngkir = products.reduce((s, p) => s + p.ongkir, 0);
       const c = calcKKValues(totNkt, totDpp, totDist, totOngkir);
       const fmt = n => 'Rp ' + formatRupiah(Math.round(n));
       const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
       set('cv-nilai-kontrak-total', fmt(totNkt));
       set('cv-dpp-kontrak', fmt(c.dppKontrak));
       set('cv-ppn-kontrak', fmt(c.ppnKontrak));
       set('cv-pph-kontrak', fmt(c.pphKontrak));
       set('cv-penerimaan', fmt(c.penerimaanUang));
       set('cv-dpp-beli', fmt(c.dppBeli));
       set('cv-ppn-beli', fmt(c.ppnBeli));
       set('cv-nilai-pembyr', fmt(c.nilaiPembyr));
       set('cv-margin', c.bMargin.toFixed(2) + '%');
       set('cv-ongkir-pct', c.ongkirPct.toFixed(2) + '%');
       set('cv-surplus', fmt(c.surplusDefisit));
       set('cv-laba', fmt(c.laba));
       set('cv-margin2', c.netMargin.toFixed(2) + '%');
       const labaEl = document.getElementById('cv-laba');
       if (labaEl) labaEl.style.color = c.laba >= 0 ? 'var(--green)' : 'var(--red)';
}

async function submitKKForm(e) {
       e.preventDefault();
       const errEl = document.getElementById('kk-form-error');
       errEl.style.display = 'none';
       const products = getKKProductsFromDOM();
       const totNkt = products.reduce((s, p) => s + p.nilai_kontrak, 0);
       if (totNkt === 0) {
              errEl.textContent = 'Minimal 1 produk dengan Nilai Kontrak harus diisi';
              errEl.style.display = 'block';
              return;
       }
       const totDpp = products.reduce((s, p) => s + p.dpp_beli, 0);
       const totDist = products.reduce((s, p) => s + p.b_distribusi, 0);
       const totOngkir = products.reduce((s, p) => s + p.ongkir, 0);
       const payload = {
              nama_pekerjaan: document.getElementById('kk-nama-pekerjaan').value.trim(),
              nomor_surat: document.getElementById('kk-nomor-surat').value.trim(),
              perihal: document.getElementById('kk-perihal').value.trim(),
              satker: document.getElementById('kk-satker').value.trim(),
              prinsipal: document.getElementById('kk-prinsipal').value.trim(),
              nama_barang: document.getElementById('kk-nama-barang').value.trim(),
              pelanggan: document.getElementById('kk-pelanggan').value.trim(),
              nilai_kontrak_total: totNkt,
              dpp_beli: totDpp,
              b_distribusi: totDist,
              ongkir: totOngkir,
              products,
              term_payment_supplier: document.getElementById('kk-tp-supplier').value.trim(),
              term_payment_pelanggan: document.getElementById('kk-tp-pelanggan').value.trim(),
              sumber_anggaran: document.getElementById('kk-sumber-anggaran').value.trim(),
              notes: document.getElementById('kk-notes').value.trim(),
       };
       try {
              const btn = e.target.querySelector('button[type="submit"]');
              btn.disabled = true; btn.textContent = '⏳ Mengirim...';
              const res = await api('/api/kk', 'POST', payload);
              const data = await res.json();
              btn.disabled = false; btn.textContent = '📤 Kirim Kertas Kerja';
              if (res.ok) {
                     showToast('✅ Kertas Kerja berhasil dikirim!', 'success');
                     setTimeout(() => showPage('my-kk'), 1200);
              } else {
                     errEl.textContent = data.error || 'Gagal mengirim';
                     errEl.style.display = 'block';
              }
       } catch {
              errEl.textContent = 'Koneksi gagal';
              errEl.style.display = 'block';
       }
}

function renderKKProgressBadge(r) {
       const lvl = r.kk_approval_level;
       const status = r.status;
       const short = ['AM', 'MK', 'GM1', 'GM2', 'DO', 'DU'];
       const steps = [1, 2, 3, 4, 5, 6].map(i => {
              let icon, cls;
              // GM1 (3) dan GM2 (4) paralel: keduanya aktif saat kk_approval_level == 3
              const atGmStage = lvl === 3 && (i === 3 || i === 4);
              if (status === 'approved') {
                     icon = '✅'; cls = 'approved';
              } else if (status === 'rejected') {
                     if (atGmStage) { icon = '❌'; cls = 'rejected'; }
                     else if (i < lvl) { icon = '✅'; cls = 'approved'; }
                     else if (i === lvl) { icon = '❌'; cls = 'rejected'; }
                     else { icon = '○'; cls = 'waiting'; }
              } else {
                     if (atGmStage) { icon = '⏳'; cls = 'current'; }
                     else if (i < lvl) { icon = '✅'; cls = 'approved'; }
                     else if (i === lvl) { icon = '⏳'; cls = 'current'; }
                     else { icon = '○'; cls = 'waiting'; }
              }
              return `<span class="kk-ps kk-ps-${cls}" title="${KK_LEVEL_LABELS[i]}">${icon} ${short[i - 1]}</span>`;
       }).join('<span class="kk-ps-sep">›</span>');
       return `<div class="kk-progress-steps">${steps}</div>`;
}

function refreshKKList() {
       const page = document.querySelector('.menu-item.active')?.getAttribute('data-page');
       if (page === 'my-kk') loadMyKK();
       else if (page === 'kk-approvals') loadKKApprovals();
       else if (page === 'admin-kk') loadAdminKK();
}

function renderKKTable(rows, { showCreator = false, showApproveBtn = false } = {}) {
       if (rows.length === 0) return emptyState('Belum ada Kertas Kerja');
       const myLvl = { area_manager: 1, manager_keuangan: 2, gm: 3, gm2: 4, direktur_ops: 5, direktur_utama: 6 }[currentUser.role];
       const tableRows = rows.map(r => {
              const lvl = r.kk_approval_level;
              const approvalBadge = renderKKProgressBadge(r);
              // gm2 dapat approve saat kk_approval_level == 3 (paralel dengan gm)
              const canAct = showApproveBtn && r.status === 'pending' && (
                     currentUser.role === 'admin' ||
                     (currentUser.role === 'gm2' && lvl === 3) ||
                     myLvl === lvl
              );
              return `<tr>
                   <td><div class="fw-bold">${escHtml(r.nama_pekerjaan)}</div>
                       <div style="font-size:11px;color:var(--text-light)">${escHtml(r.pelanggan)}</div></td>
                   ${showCreator ? `<td style="font-size:12px">${escHtml(r.creator_name || '-')}</td>` : ''}
                   <td class="text-right">Rp ${formatRupiah(r.nilai_kontrak_total)}</td>
                   <td>${approvalBadge}</td>
                   <td style="font-size:12px;color:var(--text-light)">${formatDate(r.created_at)}</td>
                   <td>
                       <div style="display:flex;gap:6px;flex-wrap:wrap">
                           <button onclick="viewKKDetail(${r.id})" class="btn btn-secondary btn-sm">🔍 Detail</button>
                           ${canAct ? `
                               <button onclick="openKKAction(${r.id},'approve')" class="btn btn-success btn-sm">✅ Setuju</button>
                               <button onclick="openKKAction(${r.id},'reject')"  class="btn btn-danger btn-sm">❌ Tolak</button>` : ''}
                           ${r.status === 'approved' ? `<button onclick="downloadKKExcel(${r.id})" class="btn btn-success btn-sm">📊 Excel</button>` : ''}
                           ${r.status === 'pending' && (currentUser.role === 'admin' || r.created_by === currentUser.id) ? `
                               <button onclick="deleteKK(${r.id})" class="btn btn-danger btn-sm">🗑️</button>` : ''}
                       </div>
                   </td>
            </tr>`;
       }).join('');
       return `<div class="table-responsive"><table class="table">
            <thead><tr>
                   <th>Nama Pekerjaan</th>
                   ${showCreator ? '<th>Diajukan Oleh</th>' : ''}
                   <th class="text-right">Nilai Kontrak</th>
                   <th>Status Approval</th>
                   <th>Tanggal</th>
                   <th>Aksi</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
     </table></div>`;
}

async function loadMyKK() {
       const container = document.getElementById('my-kk-container');
       if (!container) return;
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       const filterStatus = document.getElementById('my-kk-filter')?.value || '';
       try {
              const res = await api('/api/kk');
              let rows = await res.json();
              if (filterStatus) rows = rows.filter(r => r.status === filterStatus);
              container.innerHTML = renderKKTable(rows);
       } catch { container.innerHTML = '<div class="alert alert-error">Gagal memuat data</div>'; }
}

async function loadKKApprovals() {
       const container = document.getElementById('kk-approvals-container');
       if (!container) return;
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       const filterStatus = document.getElementById('kk-approvals-filter')?.value || 'pending';
       try {
              const res = await api('/api/kk');
              let rows = await res.json();
              if (filterStatus) rows = rows.filter(r => r.status === filterStatus);
              container.innerHTML = renderKKTable(rows, { showApproveBtn: true });
       } catch { container.innerHTML = '<div class="alert alert-error">Gagal memuat data</div>'; }
}

async function loadAdminKK() {
       const container = document.getElementById('admin-kk-container');
       if (!container) return;
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       const filterStatus = document.getElementById('admin-kk-filter')?.value || '';
       const filterMonth = document.getElementById('admin-kk-month')?.value || '';
       try {
              const res = await api('/api/kk');
              let rows = await res.json();
              if (filterStatus) rows = rows.filter(r => r.status === filterStatus);
              if (filterMonth) rows = rows.filter(r => r.created_at && r.created_at.startsWith(filterMonth));
              container.innerHTML = renderKKTable(rows, { showCreator: true, showApproveBtn: true });
       } catch { container.innerHTML = '<div class="alert alert-error">Gagal memuat data</div>'; }
}

async function viewKKDetail(id) {
       try {
              const res = await api(`/api/kk/${id}`);
              const kk = await res.json();
              if (!res.ok) { showToast(kk.error || 'Gagal memuat', 'error'); return; }
              let kkProds = []; try { kkProds = JSON.parse(kk.products || '[]'); } catch { }
              const c = kk.calc || calcKKValues(kk.nilai_kontrak_total || 0, kk.dpp_beli || (kk.nilai_pembyr || 0) / 1.11, kk.b_distribusi || 0, kk.ongkir || 0);
              const fmt = n => 'Rp ' + formatRupiah(Math.round(n));
              const approvals = kk.approvals || [];

              const approvalSteps = [1, 2, 3, 4, 5, 6].map(lvl => {
                     const a = approvals.find(x => x.level === lvl);
                     const icon = !a || a.status === 'pending' ? '⬜' : a.status === 'approved' ? '✅' : '❌';
                     const color = !a || a.status === 'pending' ? 'var(--text-light)' : a.status === 'approved' ? 'var(--green)' : 'var(--red)';
                     const isGmParallel = lvl === 4 ? ' <small style="color:var(--blue)">(paralel)</small>' : '';
                     return `<div class="kk-step">
                            <div class="kk-step-icon" style="color:${color}">${icon}</div>
                            <div class="kk-step-label">
                                   <strong>${KK_LEVEL_LABELS[lvl]}</strong>${isGmParallel}
                                   ${a?.approver_name ? `<br><small>${escHtml(a.approver_name)}</small>` : ''}
                                   ${a?.note ? `<br><small style="color:var(--text-light)">${escHtml(a.note)}</small>` : ''}
                                   ${a?.acted_at ? `<br><small style="color:var(--text-light)">${formatDate(a.acted_at)}</small>` : ''}
                            </div>
                     </div>`;
              }).join('<div class="kk-step-arrow">→</div>');

              document.getElementById('kk-detail-title').textContent = `KK — ${kk.nama_pekerjaan}`;
              document.getElementById('kk-detail-body').innerHTML = `
                     <div class="detail-grid" style="grid-template-columns:repeat(3,1fr)">
                            <div class="detail-item"><label>Status</label><div class="value"><span class="badge badge-${kk.status}">${statusLabel(kk.status)}</span></div></div>
                            <div class="detail-item"><label>Pelanggan</label><div class="value">${escHtml(kk.pelanggan)}</div></div>
                            <div class="detail-item"><label>Diajukan Oleh</label><div class="value">${escHtml(kk.creator_name || '-')}</div></div>
                            <div class="detail-item"><label>Satker</label><div class="value">${escHtml(kk.satker || '-')}</div></div>
                            <div class="detail-item"><label>Prinsipal</label><div class="value">${escHtml(kk.prinsipal || '-')}</div></div>
                            <div class="detail-item"><label>Nama Barang</label><div class="value">${escHtml(kk.nama_barang || '-')}</div></div>
                            <div class="detail-item"><label>Nomor Surat</label><div class="value">${escHtml(kk.nomor_surat || '-')}</div></div>
                            <div class="detail-item"><label>Perihal</label><div class="value">${escHtml(kk.perihal || '-')}</div></div>
                            <div class="detail-item"><label>Sumber Anggaran</label><div class="value">${escHtml(kk.sumber_anggaran || '-')}</div></div>
                     </div>
                     <div class="detail-section-title">💰 Perhitungan Keuangan</div>
                     <div class="kk-finance-grid">
                            <div class="kk-finance-block">
                                   <div class="kk-finance-title">Nilai Kontrak</div>
                                   <div class="kk-finance-row"><span>Total</span><span class="fw-bold">Rp ${formatRupiah(kk.nilai_kontrak_total)}</span></div>
                                   <div class="kk-finance-row"><span>DPP</span><span>${fmt(c.dppKontrak)}</span></div>
                                   <div class="kk-finance-row"><span>PPN 11%</span><span>${fmt(c.ppnKontrak)}</span></div>
                                   <div class="kk-finance-row"><span>PPh 1,5%</span><span>${fmt(c.pphKontrak)}</span></div>
                                   <div class="kk-finance-row kk-finance-total"><span>Penerimaan Uang</span><span>${fmt(c.penerimaanUang)}</span></div>
                            </div>
                            <div class="kk-finance-block">
                                   <div class="kk-finance-title">Pembelian</div>
                                   ${kkProds.length > 0 ? kkProds.map((p, i) => {
                     const dK = p.nilai_kontrak / 1.11; const pen = p.nilai_kontrak - dK * 0.11 - dK * 0.015;
                     const pDist = pen > 0 ? (p.b_distribusi / pen * 100).toFixed(2) + '%' : '0%';
                     const pOngk = pen > 0 ? (p.ongkir / pen * 100).toFixed(2) + '%' : '0%';
                     return `<div class="kk-finance-row" style="border-bottom:1px solid var(--gray-border);padding:4px 0;margin-bottom:2px">
                                       <span style="font-weight:600">${i + 1}. ${escHtml(p.nama || '-')}</span>
                                       <span style="font-size:11px;color:var(--text-light)">Rp ${formatRupiah(p.nilai_kontrak)}</span>
                                     </div>
                                     <div class="kk-finance-row"><span style="padding-left:10px">DPP Beli</span><span>Rp ${formatRupiah(p.dpp_beli || 0)}</span></div>
                                     <div class="kk-finance-row"><span style="padding-left:10px">B. Distribusi <small style="color:var(--blue)">${pDist}</small></span><span>Rp ${formatRupiah(p.b_distribusi || 0)}</span></div>
                                     <div class="kk-finance-row" style="margin-bottom:6px"><span style="padding-left:10px">Ongkir <small style="color:var(--blue)">${pOngk}</small></span><span>Rp ${formatRupiah(p.ongkir || 0)}</span></div>`;
              }).join('') : `
                                   <div class="kk-finance-row"><span>DPP Beli</span><span class="fw-bold">Rp ${formatRupiah(kk.dpp_beli || 0)}</span></div>
                                   <div class="kk-finance-row"><span>PPN 11%</span><span>${fmt(c.ppnBeli)}</span></div>
                                   <div class="kk-finance-row"><span>Nilai Pembayaran</span><span>${fmt(c.nilaiPembyr)}</span></div>
                                   <div class="kk-finance-row"><span>B. Distribusi</span><span>Rp ${formatRupiah(kk.b_distribusi || 0)}</span></div>
                                   <div class="kk-finance-row"><span>Ongkir</span><span>Rp ${formatRupiah(kk.ongkir || 0)}</span></div>`}
                                   <div class="kk-finance-row kk-finance-total"><span>Total Pembayaran</span><span>${fmt(c.nilaiPembyr)}</span></div>
                            </div>
                            <div class="kk-finance-block">
                                   <div class="kk-finance-title">Hasil</div>
                                   <div class="kk-finance-row"><span>% By Distribusi</span><span>${(c.bMargin || 0).toFixed(2)}%</span></div>
                                   <div class="kk-finance-row"><span>% Ongkir</span><span>${(c.ongkirPct || 0).toFixed(2)}%</span></div>
                                   <div class="kk-finance-row"><span>Surplus / Defisit</span><span style="color:${c.surplusDefisit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(c.surplusDefisit)}</span></div>
                                   <div class="kk-finance-row kk-finance-total"><span>Laba</span><span style="color:${c.laba >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(c.laba)}</span></div>
                                   <div class="kk-finance-row kk-finance-total"><span>Net Margin (%)</span><span>${c.netMargin.toFixed(2)}%</span></div>
                            </div>
                     </div>
                     <div class="detail-section-title">📋 Term of Payment</div>
                     <div class="detail-grid" style="grid-template-columns:1fr 1fr">
                            <div class="detail-item"><label>Supplier</label><div class="value">${escHtml(kk.term_payment_supplier || '-')}</div></div>
                            <div class="detail-item"><label>Pelanggan</label><div class="value">${escHtml(kk.term_payment_pelanggan || '-')}</div></div>
                     </div>
                     <div class="detail-section-title">🔄 Progress Approval</div>
                     <div class="kk-approval-steps">${approvalSteps}</div>
                     ${kk.status === 'rejected' ? `<div class="alert alert-error" style="margin-top:12px">❌ Alasan Penolakan: ${escHtml(kk.reject_reason || '-')}</div>` : ''}
            `;

              const lvl = kk.kk_approval_level;
              const myRole = currentUser.role;
              const myLvl = { area_manager: 1, manager_keuangan: 2, gm: 3, gm2: 4, direktur_ops: 5, direktur_utama: 6 }[myRole];
              let canAct = false;
              if (myRole === 'admin') {
                     canAct = kk.status === 'pending';
              } else if (myRole === 'gm') {
                     const myApproval = approvals.find(a => a.level === 3);
                     canAct = kk.status === 'pending' && lvl === 3 && (!myApproval || myApproval.status === 'pending');
              } else if (myRole === 'gm2') {
                     const myApproval = approvals.find(a => a.level === 4);
                     canAct = kk.status === 'pending' && lvl === 3 && (!myApproval || myApproval.status === 'pending');
              } else if (myLvl) {
                     canAct = kk.status === 'pending' && myLvl === lvl;
              }
              let footer = '';
              if (canAct) {
                     footer += `<button onclick="closeModal('modal-kk-detail');setTimeout(()=>openKKAction(${id},'approve'),200)" class="btn btn-success">✅ Setujui</button>`;
                     footer += `<button onclick="closeModal('modal-kk-detail');setTimeout(()=>openKKAction(${id},'reject'),200)" class="btn btn-danger">❌ Tolak</button>`;
              }
              if (kk.status === 'approved') footer += `<button onclick="downloadKKExcel(${id})" class="btn btn-success">📊 Unduh Excel</button>`;
              if (kk.status === 'pending' && (currentUser.role === 'admin' || kk.created_by === currentUser.id)) {
                     footer += `<button onclick="deleteKK(${id})" class="btn btn-danger">🗑️ Hapus</button>`;
              }
              footer += `<button onclick="closeModal('modal-kk-detail')" class="btn btn-outline">Tutup</button>`;
              document.getElementById('kk-detail-footer').innerHTML = footer;
              showModal('modal-kk-detail');
       } catch { showToast('Gagal memuat detail KK', 'error'); }
}

function openKKAction(id, type) {
       kkActionTargetId = id;
       kkActionType = type;
       document.getElementById('kk-action-note').value = '';
       document.getElementById('kk-action-error').style.display = 'none';
       document.getElementById('kk-action-title').textContent = type === 'approve' ? '✅ Setujui Kertas Kerja' : '❌ Tolak Kertas Kerja';
       const footer = type === 'approve'
              ? `<button onclick="submitKKAction()" class="btn btn-success">✅ Konfirmasi Setuju</button>`
              : `<button onclick="submitKKAction()" class="btn btn-danger">❌ Konfirmasi Tolak</button>`;
       document.getElementById('kk-action-footer').innerHTML = footer + `<button onclick="closeModal('modal-kk-action')" class="btn btn-outline">Batal</button>`;
       showModal('modal-kk-action');
}

async function submitKKAction() {
       const note = document.getElementById('kk-action-note').value.trim();
       const errEl = document.getElementById('kk-action-error');
       errEl.style.display = 'none';
       if (kkActionType === 'reject' && !note) {
              errEl.textContent = 'Harap isi alasan penolakan';
              errEl.style.display = 'block'; return;
       }
       try {
              const endpoint = `/api/kk/${kkActionTargetId}/${kkActionType}`;
              const res = await api(endpoint, 'POST', { note });
              const data = await res.json();
              if (res.ok) {
                     showToast(kkActionType === 'approve' ? '✅ Disetujui!' : '❌ Ditolak', 'success');
                     closeModal('modal-kk-action');
                     refreshKKList();
              } else {
                     errEl.textContent = data.error || 'Gagal';
                     errEl.style.display = 'block';
              }
       } catch {
              errEl.textContent = 'Koneksi gagal';
              errEl.style.display = 'block';
       }
}

async function downloadKKExcel(id) {
       showToast('⏳ Menyiapkan Excel...', '');
       try {
              const res = await fetch(`/api/kk/${id}/export-excel`);
              if (!res.ok) { const d = await res.json(); showToast(d.error || 'Gagal', 'error'); return; }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const filename = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || `KK_${id}.xlsx`;
              const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
              URL.revokeObjectURL(url);
              showToast('✅ Excel berhasil diunduh!', 'success');
       } catch { showToast('Gagal mengunduh Excel', 'error'); }
}

async function deleteKK(id) {
       if (!confirm('Hapus Kertas Kerja ini?')) return;
       try {
              const res = await api(`/api/kk/${id}`, 'DELETE');
              const data = await res.json();
              if (res.ok) { showToast('KK berhasil dihapus', 'success'); closeModal('modal-kk-detail'); refreshKKList(); }
              else showToast(data.error || 'Gagal menghapus', 'error');
       } catch { showToast('Koneksi gagal', 'error'); }
}

// ===================== GANTI / RESET PASSWORD =====================
function openChangePasswordModal() {
       document.getElementById('cp-old').value = '';
       document.getElementById('cp-new').value = '';
       document.getElementById('cp-confirm').value = '';
       document.getElementById('cp-error').style.display = 'none';
       showModal('modal-change-password');
}

async function submitChangePassword() {
       const oldPwd = document.getElementById('cp-old').value.trim();
       const newPwd = document.getElementById('cp-new').value.trim();
       const confirm = document.getElementById('cp-confirm').value.trim();
       const errEl = document.getElementById('cp-error');
       errEl.style.display = 'none';
       if (!oldPwd || !newPwd || !confirm) {
              errEl.textContent = 'Semua field wajib diisi';
              errEl.style.display = 'block'; return;
       }
       if (newPwd.length < 6) {
              errEl.textContent = 'Password baru minimal 6 karakter';
              errEl.style.display = 'block'; return;
       }
       if (newPwd !== confirm) {
              errEl.textContent = 'Konfirmasi password tidak cocok';
              errEl.style.display = 'block'; return;
       }
       try {
              const res = await api('/api/auth/change-password', 'POST', { current_password: oldPwd, new_password: newPwd });
              const data = await res.json();
              if (res.ok) {
                     showToast('✅ Password berhasil diubah', 'success');
                     closeModal('modal-change-password');
              } else {
                     errEl.textContent = data.error || 'Gagal mengubah password';
                     errEl.style.display = 'block';
              }
       } catch {
              errEl.textContent = 'Koneksi ke server gagal';
              errEl.style.display = 'block';
       }
}

let resetPasswordTargetId = null;

function openResetPasswordModal(id, name) {
       resetPasswordTargetId = id;
       document.getElementById('rp-new').value = '';
       document.getElementById('rp-confirm').value = '';
       document.getElementById('rp-error').style.display = 'none';
       document.getElementById('reset-pwd-desc').textContent = `Reset password untuk akun: ${name}`;
       showModal('modal-reset-password');
}

async function submitResetPassword() {
       const newPwd = document.getElementById('rp-new').value.trim();
       const confirm = document.getElementById('rp-confirm').value.trim();
       const errEl = document.getElementById('rp-error');
       errEl.style.display = 'none';
       if (!newPwd || !confirm) {
              errEl.textContent = 'Semua field wajib diisi';
              errEl.style.display = 'block'; return;
       }
       if (newPwd.length < 6) {
              errEl.textContent = 'Password minimal 6 karakter';
              errEl.style.display = 'block'; return;
       }
       if (newPwd !== confirm) {
              errEl.textContent = 'Konfirmasi password tidak cocok';
              errEl.style.display = 'block'; return;
       }
       try {
              const res = await api(`/api/submissions/meta/users/${resetPasswordTargetId}/password`, 'PUT', { new_password: newPwd });
              const data = await res.json();
              if (res.ok) {
                     showToast('✅ Password berhasil direset', 'success');
                     closeModal('modal-reset-password');
              } else {
                     errEl.textContent = data.error || 'Gagal mereset password';
                     errEl.style.display = 'block';
              }
       } catch {
              errEl.textContent = 'Koneksi ke server gagal';
              errEl.style.display = 'block';
       }
}

// ===================== HELPERS =====================
function api(url, method = 'GET', body = null) {
       const opts = { method, headers: { 'Content-Type': 'application/json' } };
       if (body) opts.body = JSON.stringify(body);
       return fetch(url, opts);
}

function formatRupiah(n) {
       if (!n && n !== 0) return '0';
       return new Intl.NumberFormat('id-ID').format(Math.round(parseFloat(n)));
}

function formatRupiahShort(n) {
       n = Math.round(parseFloat(n) || 0);
       if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace('.', ',') + ' M';
       if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.', ',') + ' Jt';
       if (n >= 1000) return (n / 1000).toFixed(0) + ' Rb';
       return String(n);
}

function formatDate(str) {
       if (!str) return '-';
       const d = new Date(str);
       if (isNaN(d)) return str;
       return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status) {
       return { pending: '⏳ Menunggu', approved: '✅ Disetujui', rejected: '❌ Ditolak' }[status] || status;
}

function escHtml(str) {
       if (!str) return '';
       return String(str)
              .replace(/&/g, '&amp;').replace(/</g, '&lt;')
              .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emptyState(msg) {
       return `<div class="empty-state"><div class="empty-icon">📭</div><p>${msg}</p></div>`;
}

function showModal(id) {
       document.getElementById(id).style.display = 'flex';
       document.body.style.overflow = 'hidden';
}

function closeModal(id) {
       document.getElementById(id).style.display = 'none';
       document.body.style.overflow = '';
}

function showToast(msg, type = '') {
       const t = document.getElementById('toast');
       t.textContent = msg;
       t.className = `toast ${type}`;
       t.style.display = 'block';
       clearTimeout(t._timer);
       t._timer = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

// ============================================================
//  SPPD - Surat Perintah Perjalanan Dinas
// ============================================================

let sppdItinRowCount = 0;
let laporanKunjunganRowCount = 0;
let laporanBiayaRowCount = 0;
let currentSppdId = null;

// ── Approval progress badge ───────────────────────────────────────────────────
// sppd_approval_level: 0=waiting AM, 1=AM done waiting GM1+GM2 parallel, 2=all approved
function renderSPPDProgressBadge(sppd) {
       const lvl = sppd.sppd_approval_level;
       const status = sppd.status;

       const stepState = (stepIdx) => {
              // stepIdx: 0=AM, 1=GM1, 2=GM2
              if (status === 'approved' || status === 'completed') return 'approved';
              if (status === 'rejected') {
                     if (stepIdx === 0 && lvl === 0) return 'rejected';
                     if (stepIdx > 0 && lvl === 1) return 'rejected';
                     if (stepIdx === 0 && lvl >= 1) return 'approved';
                     return 'waiting';
              }
              if (stepIdx === 0) return lvl === 0 ? 'current' : 'approved';
              if (stepIdx === 1) {
                     if (lvl > 1) return 'approved';
                     if (lvl === 1) return sppd.gm1_approved ? 'approved' : 'current';
                     return 'waiting';
              }
              if (stepIdx === 2) {
                     if (lvl > 1) return 'approved';
                     if (lvl === 1) return sppd.gm2_approved ? 'approved' : 'current';
                     return 'waiting';
              }
              return 'waiting';
       };

       const iconOf = s => ({ approved: '✅', rejected: '❌', current: '⏳', waiting: '○' }[s]);
       const short = ['AM', 'GM1', 'GM2'];
       const labels = ['Area Manager', 'GM 1', 'GM 2'];
       const steps = [0, 1, 2].map(i => {
              const s = stepState(i);
              return `<span class="kk-ps kk-ps-${s}" title="${labels[i]}">${iconOf(s)} ${short[i]}</span>`;
       }).join('<span class="kk-ps-sep">›</span>');
       return `<div class="kk-progress-steps">${steps}</div>`;
}

function sppdStatusBadge(sppd) {
       const statusMap = {
              pending: '<span class="badge badge-pending">⏳ Menunggu</span>',
              approved: '<span class="badge badge-approved">✅ Disetujui</span>',
              rejected: '<span class="badge badge-rejected">❌ Ditolak</span>',
              completed: '<span class="badge badge-info">🏁 Selesai</span>',
       };
       return statusMap[sppd.status] || sppd.status;
}

// ── SPPD table renderer ───────────────────────────────────────────────────────
function renderSPPDTable(rows, { showCreator = false, showApproveBtn = false } = {}) {
       if (!rows.length) return emptyState('Tidak ada data SPPD');
       const ths = [
              '<th>Nomor</th>',
              '<th>Nama Pegawai</th>',
              showCreator ? '<th>Dibuat oleh</th>' : '',
              '<th>Tujuan</th>',
              '<th>Tanggal</th>',
              '<th>Status</th>',
              '<th>Progress</th>',
              '<th>Aksi</th>',
       ].join('');
       const tds = rows.map(r => {
              const approveBtn = showApproveBtn && r.status === 'pending'
                     ? `<button onclick="openSPPDAction(${r.id},'approve')" class="btn btn-sm btn-success">✅ Approve</button> `
                     : '';
              const pdfBtn = ['approved', 'completed'].includes(r.status)
                     ? `<a href="/api/sppd/${r.id}/download/pdf" target="_blank" class="btn btn-sm btn-pdf" title="Unduh PDF">🖨️</a> `
                     : '';
              return `<tr>
              <td><span style="font-family:monospace;font-size:12px">${escHtml(r.nomor)}</span></td>
              <td>${escHtml(r.nama_pegawai)}</td>
              ${showCreator ? `<td>${escHtml(r.creator_name || '')}</td>` : ''}
              <td>${escHtml(r.tujuan)}</td>
              <td style="white-space:nowrap">${r.tanggal_berangkat} – ${r.tanggal_kembali}</td>
              <td>${sppdStatusBadge(r)}</td>
              <td>${renderSPPDProgressBadge(r)}</td>
              <td style="white-space:nowrap">
                ${approveBtn}${pdfBtn}
                <button onclick="viewSPPDDetail(${r.id})" class="btn btn-sm btn-outline">🔍 Detail</button>
              </td>
            </tr>`;
       }).join('');
       return `<div class="table-responsive"><table class="table"><thead><tr>${ths}</tr></thead><tbody>${tds}</tbody></table></div>`;
}

// ── List loaders ──────────────────────────────────────────────────────────────
async function loadMySPPD() {
       const filter = document.getElementById('my-sppd-filter')?.value || '';
       const container = document.getElementById('my-sppd-container');
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       try {
              const res = await api('/api/sppd');
              let rows = await res.json();
              rows = rows.filter(r => r.created_by === currentUser.id);
              const filtered = filter ? rows.filter(r => r.status === filter) : rows;
              const isAdminRole = currentUser.role === 'admin';
              container.innerHTML = renderSPPDTable(filtered, { showApproveBtn: isAdminRole });
       } catch { container.innerHTML = emptyState('Gagal memuat data'); }
}

async function loadSPPDApprovals() {
       const filter = document.getElementById('sppd-approvals-filter')?.value || '';
       const container = document.getElementById('sppd-approvals-container');
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       try {
              const res = await api('/api/sppd');
              let rows = await res.json();
              if (filter) rows = rows.filter(r => r.status === filter);
              container.innerHTML = renderSPPDTable(rows, { showCreator: true, showApproveBtn: true });
       } catch { container.innerHTML = emptyState('Gagal memuat data'); }
}

async function loadAdminSPPD() {
       const filter = document.getElementById('admin-sppd-filter')?.value || '';
       const container = document.getElementById('admin-sppd-container');
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       try {
              const res = await api('/api/sppd');
              let rows = await res.json();
              if (filter) rows = rows.filter(r => r.status === filter);
              container.innerHTML = renderSPPDTable(rows, { showCreator: true, showApproveBtn: true });
       } catch { container.innerHTML = emptyState('Gagal memuat data'); }
}

// ── Laporan Approvals list ────────────────────────────────────────────────────
async function loadLaporanApprovals() {
       const filter = document.getElementById('laporan-approvals-filter')?.value || '';
       const container = document.getElementById('laporan-approvals-container');
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       try {
              const res = await api('/api/sppd/laporan');
              let rows = await res.json();
              if (filter) rows = rows.filter(r => r.status === filter);
              if (!rows.length) { container.innerHTML = emptyState('Tidak ada laporan'); return; }
              const fmtRp = v => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0);
              const trs = rows.map(r => {
                     const lvlLabel = LAPORAN_LEVEL_LABELS[r.laporan_approval_level] || `Lv ${r.laporan_approval_level}`;
                     const statusBadge = r.status === 'approved' ? '<span class="badge badge-approved">✅ Disetujui</span>'
                            : r.status === 'rejected' ? '<span class="badge badge-rejected">❌ Ditolak</span>'
                                   : `<span class="badge badge-pending">⏳ ${lvlLabel}</span>`;
                     return `<tr>
                            <td>${escHtml(r.nomor || '-')}</td>
                            <td>${escHtml(r.nama_pegawai)}</td>
                            <td>${escHtml(r.tujuan)}</td>
                            <td>${r.tanggal_laporan || '-'}</td>
                            <td>${statusBadge}</td>
                            <td>${fmtRp(r.total_biaya)}</td>
                            <td><button onclick="viewSPPDDetail(${r.sppd_id})" class="btn btn-sm btn-outline">🔍 Detail</button></td>
                     </tr>`;
              }).join('');
              container.innerHTML = `<div class="table-responsive"><table class="table">
                     <thead><tr><th>No. SPPD</th><th>Pegawai</th><th>Tujuan</th><th>Tgl Laporan</th><th>Status</th><th>Total Biaya</th><th>Aksi</th></tr></thead>
                     <tbody>${trs}</tbody></table></div>`;
       } catch { container.innerHTML = emptyState('Gagal memuat data'); }
}

// ── Pencairan list (all KK-type approvers) ────────────────────────────────────
async function loadPencairan() {
       const filter = document.getElementById('pencairan-filter')?.value || '';
       const container = document.getElementById('pencairan-container');
       container.innerHTML = '<div class="loading">⏳ Memuat...</div>';
       try {
              const res = await api('/api/sppd/pencairan');
              let rows = await res.json();
              if (filter) rows = rows.filter(r => r.status === filter);
              if (!rows.length) { container.innerHTML = emptyState('Tidak ada data pencairan'); return; }
              const fmtRp = v => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0);
              const statusBadgeMap = {
                     belum_cair: '<span class="badge badge-pending">🔴 Belum Cair</span>',
                     dalam_proses: '<span class="badge badge-info">🟡 Dalam Proses</span>',
                     sudah_cair: '<span class="badge badge-approved">🟢 Sudah Cair</span>',
                     ditolak: '<span class="badge badge-rejected">❌ Ditolak</span>',
              };
              const role = currentUser.role;
              const trs = rows.map(r => {
                     const lvl = r.pencairan_approval_level;
                     const lvlLabel = PENCAIRAN_LEVEL_LABELS[lvl] || `Lv ${lvl}`;
                     const progressBadge = r.status === 'sudah_cair'
                            ? '<span class="badge badge-approved">✅ Selesai</span>'
                            : r.status === 'ditolak'
                                   ? '<span class="badge badge-rejected">❌ Ditolak</span>'
                                   : `<span class="badge badge-pending">⏳ ${lvlLabel}</span>`;

                     const canAct = r.status !== 'sudah_cair' && r.status !== 'ditolak' && (
                            (role === 'area_manager' && lvl === 1) ||
                            (role === 'manager_keuangan' && lvl === 2) ||
                            (role === 'gm' && lvl === 3) ||
                            (role === 'gm2' && lvl === 3) ||
                            (role === 'direktur_ops' && lvl === 5) ||
                            (role === 'direktur_utama' && lvl === 6) ||
                            role === 'admin'
                     );
                     const editBtn = (role === 'manager_keuangan' || role === 'admin')
                            ? `<button onclick="openUpdatePencairan(${r.sppd_id})" class="btn btn-sm btn-outline">✏️ Edit</button> `
                            : '';
                     const approveBtn = canAct
                            ? `<button onclick="openPencairanAction(${r.sppd_id},'approve')" class="btn btn-sm btn-success">✅</button> <button onclick="openPencairanAction(${r.sppd_id},'reject')" class="btn btn-sm btn-danger">❌</button>`
                            : '';
                     return `<tr>
                            <td>${escHtml(r.nomor || '-')}</td>
                            <td>${escHtml(r.nama_pegawai)}</td>
                            <td>${escHtml(r.tujuan)}</td>
                            <td>${fmtRp(r.jumlah_usulan)}</td>
                            <td>${fmtRp(r.jumlah_realisasi)}</td>
                            <td>${fmtRp(r.jumlah_dicairkan)}</td>
                            <td>${statusBadgeMap[r.status] || r.status}</td>
                            <td>${progressBadge}</td>
                            <td>${editBtn}${approveBtn}</td>
                     </tr>`;
              }).join('');
              container.innerHTML = `<div class="table-responsive"><table class="table">
                     <thead><tr><th>No. SPPD</th><th>Pegawai</th><th>Tujuan</th><th>Uang Muka</th><th>Realisasi</th><th>Dicairkan</th><th>Status</th><th>Progress</th><th>Aksi</th></tr></thead>
                     <tbody>${trs}</tbody></table></div>`;
       } catch { container.innerHTML = emptyState('Gagal memuat data'); }
}

// ── Approve / Reject Pencairan ────────────────────────────────────────────────
let pencairanActionSppdId = null;
let pencairanActionType = null;

function openPencairanAction(sppdId, type) {
       pencairanActionSppdId = sppdId;
       pencairanActionType = type;
       document.getElementById('sppd-action-title').textContent = type === 'approve' ? '✅ Setujui Pencairan' : '❌ Tolak Pencairan';
       document.getElementById('sppd-action-note').value = '';
       document.getElementById('sppd-action-error').style.display = 'none';
       document.getElementById('sppd-action-footer').innerHTML = `
              <button onclick="confirmPencairanAction()" class="btn btn-${type === 'approve' ? 'success' : 'danger'}">
                     ${type === 'approve' ? '✅ Ya, Setujui' : '❌ Ya, Tolak'}
              </button>
              <button onclick="closeModal('modal-sppd-action')" class="btn btn-outline">Batal</button>`;
       showModal('modal-sppd-action');
}

async function confirmPencairanAction() {
       const errEl = document.getElementById('sppd-action-error');
       errEl.style.display = 'none';
       const note = document.getElementById('sppd-action-note').value;
       try {
              const res = await api(`/api/sppd/${pencairanActionSppdId}/pencairan/${pencairanActionType}`, 'POST', { note });
              const data = await res.json();
              if (!res.ok) { errEl.textContent = data.error || 'Gagal'; errEl.style.display = 'block'; return; }
              closeModal('modal-sppd-action');
              showToast(pencairanActionType === 'approve' ? 'Pencairan disetujui!' : 'Pencairan ditolak!', 'success');
              loadPencairan();
       } catch { errEl.textContent = 'Koneksi gagal'; errEl.style.display = 'block'; }
}

function openPencairanActionFromDetail(sppdId, type) {
       pencairanActionSppdId = sppdId;
       pencairanActionType = type;
       document.getElementById('sppd-action-title').textContent = type === 'approve' ? '✅ Setujui Pencairan' : '❌ Tolak Pencairan';
       document.getElementById('sppd-action-note').value = '';
       document.getElementById('sppd-action-error').style.display = 'none';
       document.getElementById('sppd-action-footer').innerHTML = `
              <button onclick="confirmPencairanActionFromDetail()" class="btn btn-${type === 'approve' ? 'success' : 'danger'}">
                     ${type === 'approve' ? '✅ Ya, Setujui' : '❌ Ya, Tolak'}
              </button>
              <button onclick="closeModal('modal-sppd-action')" class="btn btn-outline">Batal</button>`;
       showModal('modal-sppd-action');
}

async function confirmPencairanActionFromDetail() {
       const errEl = document.getElementById('sppd-action-error');
       errEl.style.display = 'none';
       const note = document.getElementById('sppd-action-note').value;
       try {
              const res = await api(`/api/sppd/${pencairanActionSppdId}/pencairan/${pencairanActionType}`, 'POST', { note });
              const data = await res.json();
              if (!res.ok) { errEl.textContent = data.error || 'Gagal'; errEl.style.display = 'block'; return; }
              closeModal('modal-sppd-action');
              showToast(pencairanActionType === 'approve' ? 'Pencairan disetujui!' : 'Pencairan ditolak!', 'success');
              viewSPPDDetail(pencairanActionSppdId);
       } catch { errEl.textContent = 'Koneksi gagal'; errEl.style.display = 'block'; }
}

// ── Update Pencairan (manager_keuangan) ───────────────────────────────────────
let updatePencairanSppdId = null;

async function openUpdatePencairan(sppdId) {
       updatePencairanSppdId = sppdId;
       try {
              const [sppdRes, pencRes] = await Promise.all([api(`/api/sppd/${sppdId}`), api(`/api/sppd/${sppdId}/pencairan`)]);
              const sppd = await sppdRes.json();
              const pencairan = pencRes.ok ? await pencRes.json() : null;
              if (!pencairan) { showToast('Data pencairan tidak ditemukan', 'error'); return; }
              const fmtRp = v => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0);
              document.getElementById('pencairan-modal-info').innerHTML = `
                     <strong>SPPD:</strong> ${escHtml(sppd.nomor)} &nbsp;|&nbsp; <strong>Pegawai:</strong> ${escHtml(sppd.nama_pegawai)}<br>
                     <strong>Uang Muka:</strong> ${fmtRp(pencairan.jumlah_usulan)} &nbsp;|&nbsp; <strong>Realisasi Biaya:</strong> ${fmtRp(pencairan.jumlah_realisasi)}`;
              document.getElementById('pencairan-update-status').value = pencairan.status || 'belum_cair';
              document.getElementById('pencairan-update-jumlah').value = pencairan.jumlah_dicairkan || 0;
              document.getElementById('pencairan-update-catatan').value = pencairan.catatan || '';
              document.getElementById('pencairan-update-error').style.display = 'none';
              showModal('modal-update-pencairan');
       } catch { showToast('Gagal memuat data', 'error'); }
}

async function submitUpdatePencairan() {
       const errEl = document.getElementById('pencairan-update-error');
       errEl.style.display = 'none';
       const body = {
              status: document.getElementById('pencairan-update-status').value,
              jumlah_dicairkan: Number(document.getElementById('pencairan-update-jumlah').value) || 0,
              catatan: document.getElementById('pencairan-update-catatan').value,
       };
       try {
              const res = await api(`/api/sppd/${updatePencairanSppdId}/pencairan`, 'PUT', body);
              const data = await res.json();
              if (!res.ok) { errEl.textContent = data.error || 'Gagal'; errEl.style.display = 'block'; return; }
              closeModal('modal-update-pencairan');
              showToast('Status pencairan diperbarui!', 'success');
              loadPencairan();
       } catch { errEl.textContent = 'Koneksi gagal'; errEl.style.display = 'block'; }
}

// ── Refresh helper ────────────────────────────────────────────────────────────
function refreshSPPDList() {
       const activePage = document.querySelector('.content-page:not([style*="display: none"]):not([style*="display:none"])');
       if (!activePage) return;
       const id = activePage.id;
       if (id === 'content-my-sppd') loadMySPPD();
       else if (id === 'content-sppd-approvals') loadSPPDApprovals();
       else if (id === 'content-admin-sppd') loadAdminSPPD();
}

// ── SPPD Form ─────────────────────────────────────────────────────────────────
function initSPPDForm() {
       document.getElementById('form-sppd').reset();
       document.getElementById('sppd-itinerary-tbody').innerHTML = '';
       sppdItinRowCount = 0;
       document.getElementById('sppd-form-error').style.display = 'none';
       document.querySelectorAll('.sppd-biaya-field').forEach(el => { el.value = 0; });
       document.getElementById('sppd-biaya-total').textContent = 'Rp 0';
       if (currentUser) {
              document.getElementById('sppd-nama-pegawai').value = currentUser.full_name || '';
              if (currentUser.jabatan_detail) document.getElementById('sppd-jabatan').value = currentUser.jabatan_detail;
              if (currentUser.area_kerja) document.getElementById('sppd-area-kerja').value = currentUser.area_kerja;
       }
       addSPPDKunjunganRow();
}

function addSPPDKunjunganRow() {
       sppdItinRowCount++;
       const n = sppdItinRowCount;
       const tbody = document.getElementById('sppd-itinerary-tbody');
       const tr = document.createElement('tr');
       tr.id = `sppd-itin-row-${n}`;
       tr.innerHTML = `
              <td><input type="date" class="sppd-itin-tgl" style="width:100%"></td>
              <td><input type="text" class="sppd-itin-lokasi" placeholder="Lokasi" style="width:100%"></td>
              <td><input type="text" class="sppd-itin-pelanggan" placeholder="Nama pelanggan/instansi" style="width:100%"></td>
              <td><input type="text" class="sppd-itin-aktivitas" placeholder="Rencana aktivitas" style="width:100%"></td>
              <td><input type="number" class="sppd-itin-nilai" min="0" value="0" style="width:100%"></td>
              <td><input type="text" class="sppd-itin-produk" placeholder="Produk" style="width:100%"></td>
              <td><button type="button" onclick="document.getElementById('sppd-itin-row-${n}').remove()" class="btn btn-sm btn-danger">✕</button></td>`;
       tbody.appendChild(tr);
}

function updateSPPDBiayaTotal() {
       const fields = document.querySelectorAll('.sppd-biaya-field');
       let total = 0;
       fields.forEach(f => { total += Number(f.value) || 0; });
       const fmt = v => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v);
       document.getElementById('sppd-biaya-total').textContent = fmt(total);
}

async function submitSPPDForm(e) {
       e.preventDefault();
       const errEl = document.getElementById('sppd-form-error');
       errEl.style.display = 'none';
       const itinerary = [];
       document.querySelectorAll('#sppd-itinerary-tbody tr').forEach(tr => {
              itinerary.push({
                     tanggal: tr.querySelector('.sppd-itin-tgl')?.value || '',
                     lokasi: tr.querySelector('.sppd-itin-lokasi')?.value || '',
                     pelanggan: tr.querySelector('.sppd-itin-pelanggan')?.value || '',
                     aktivitas: tr.querySelector('.sppd-itin-aktivitas')?.value || '',
                     sasaran_nilai_project: Number(tr.querySelector('.sppd-itin-nilai')?.value) || 0,
                     produk: tr.querySelector('.sppd-itin-produk')?.value || '',
              });
       });
       const biaya = {
              akomodasi: Number(document.getElementById('biaya-akomodasi').value) || 0,
              konsumsi: Number(document.getElementById('biaya-konsumsi').value) || 0,
              transportasi: Number(document.getElementById('biaya-transportasi').value) || 0,
              entertain: Number(document.getElementById('biaya-entertain').value) || 0,
              uang_saku: Number(document.getElementById('biaya-uang-saku').value) || 0,
              biaya_lain: Number(document.getElementById('biaya-lain').value) || 0,
              biaya_lain_ket: document.getElementById('biaya-lain-ket').value,
       };
       const body = {
              nama_pegawai: document.getElementById('sppd-nama-pegawai').value,
              jabatan: document.getElementById('sppd-jabatan').value,
              area_kerja: document.getElementById('sppd-area-kerja').value,
              tujuan: document.getElementById('sppd-tujuan').value,
              keperluan: document.getElementById('sppd-keperluan').value,
              tanggal_berangkat: document.getElementById('sppd-tgl-berangkat').value,
              tanggal_kembali: document.getElementById('sppd-tgl-kembali').value,
              transport: document.getElementById('sppd-transport').value,
              uang_muka: Number(document.getElementById('sppd-uang-muka').value) || 0,
              itinerary, biaya,
       };
       try {
              const res = await api('/api/sppd', 'POST', body);
              const data = await res.json();
              if (!res.ok) { errEl.textContent = data.error || 'Gagal kirim SPPD'; errEl.style.display = 'block'; return; }
              showToast('SPPD berhasil dikirim!', 'success');
              showPage('my-sppd');
       } catch { errEl.textContent = 'Koneksi gagal'; errEl.style.display = 'block'; }
}

// ── View SPPD Detail ──────────────────────────────────────────────────────────
async function viewSPPDDetail(id) {
       currentSppdId = id;
       document.getElementById('sppd-detail-body').innerHTML = '<div class="loading">⏳ Memuat...</div>';
       document.getElementById('sppd-detail-footer').innerHTML = '';
       showModal('modal-sppd-detail');
       try {
              const [sppdRes, laporanRes, pencairanRes] = await Promise.all([
                     api(`/api/sppd/${id}`),
                     api(`/api/sppd/${id}/laporan`),
                     api(`/api/sppd/${id}/pencairan`),
              ]);
              const sppd = await sppdRes.json();
              const laporan = laporanRes.ok ? await laporanRes.json() : null;
              const pencairan = pencairanRes.ok ? await pencairanRes.json() : null;

              document.getElementById('sppd-detail-title').textContent = `SPPD: ${sppd.nomor}`;
              document.getElementById('sppd-detail-body').innerHTML = renderSPPDDetail(sppd, laporan, pencairan);

              const footer = [];
              const role = currentUser.role;
              const isOwner = currentUser.id === sppd.created_by;
              const canApprove = (SPPD_APPROVER_ROLES.includes(role) || role === 'admin') && sppd.status === 'pending';
              const canSubmitLaporan = isOwner && sppd.status === 'approved' && !laporan;

              // Laporan: check if user's role can act at current laporan level
              const lLvl = laporan?.laporan_approval_level;
              const canApproveLaporan = laporan && laporan.status === 'pending' && (
                     role === 'admin' ||
                     (role === 'area_manager' && lLvl === 1) ||
                     (role === 'manager_keuangan' && lLvl === 2) ||
                     ((role === 'gm' || role === 'gm2') && lLvl === 3) ||
                     (role === 'direktur_ops' && lLvl === 5) ||
                     (role === 'direktur_utama' && lLvl === 6)
              );

              // Pencairan: check if user's role can act at current pencairan level
              const pLvl = pencairan?.pencairan_approval_level;
              const pencairanActive = pencairan && pencairan.status !== 'sudah_cair' && pencairan.status !== 'ditolak';
              const canApprovePencairan = pencairanActive && (
                     role === 'admin' ||
                     (role === 'area_manager' && pLvl === 1) ||
                     (role === 'manager_keuangan' && pLvl === 2) ||
                     ((role === 'gm' || role === 'gm2') && pLvl === 3) ||
                     (role === 'direktur_ops' && pLvl === 5) ||
                     (role === 'direktur_utama' && pLvl === 6)
              );

              if (canApprove) {
                     footer.push(`<button onclick="openSPPDAction(${id},'approve')" class="btn btn-success">✅ Setujui</button>`);
                     footer.push(`<button onclick="openSPPDAction(${id},'reject')" class="btn btn-danger">❌ Tolak</button>`);
              }
              if (['approved', 'completed'].includes(sppd.status)) {
                     footer.push(`<a href="/api/sppd/${id}/download/pdf" target="_blank" class="btn btn-pdf">🖨️ Cetak PDF</a>`);
              }
              if (canSubmitLaporan) footer.push(`<button onclick="openLaporanForm(${id})" class="btn btn-primary">📋 Buat Laporan</button>`);
              if (canApproveLaporan) {
                     footer.push(`<button onclick="openLaporanAction(${id},null,'approve')" class="btn btn-success">✅ Setujui Laporan</button>`);
                     footer.push(`<button onclick="openLaporanAction(${id},null,'reject')" class="btn btn-danger">❌ Tolak Laporan</button>`);
              }
              if (canApprovePencairan) {
                     footer.push(`<button onclick="openPencairanActionFromDetail(${id},'approve')" class="btn btn-success">✅ Setujui Pencairan</button>`);
                     footer.push(`<button onclick="openPencairanActionFromDetail(${id},'reject')" class="btn btn-danger">❌ Tolak Pencairan</button>`);
              }
              footer.push(`<button onclick="closeModal('modal-sppd-detail')" class="btn btn-outline">Tutup</button>`);
              document.getElementById('sppd-detail-footer').innerHTML = footer.join(' ');
       } catch (err) {
              console.error(err);
              document.getElementById('sppd-detail-body').innerHTML = emptyState('Gagal memuat detail');
       }
}

function renderSPPDDetail(sppd, laporan, pencairan) {
       const fmt = v => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0);
       const itinRows = (sppd.itinerary || []).map(r =>
              `<tr><td>${r.tanggal}</td><td>${escHtml(r.lokasi || r.dari || '')}</td><td>${escHtml(r.pelanggan || r.ke || '')}</td><td>${escHtml(r.aktivitas || r.transport || '')}</td><td>${r.sasaran_nilai_project ? fmt(r.sasaran_nilai_project) : '-'}</td><td>${escHtml(r.produk || '')}</td></tr>`
       ).join('') || '<tr><td colspan="6" class="text-center" style="color:var(--text-light)">Tidak ada rencana kunjungan</td></tr>';

       const approvalRows = (sppd.approvals || []).map(a =>
              `<tr><td>${SPPD_LEVEL_LABELS[a.level] || a.level}</td><td>${escHtml(a.approver_name || '-')}</td>
               <td><span class="badge badge-${a.status === 'approved' ? 'approved' : 'rejected'}">${a.status}</span></td>
               <td>${escHtml(a.note || '-')}</td><td>${a.acted_at || '-'}</td></tr>`
       ).join('') || '<tr><td colspan="5" class="text-center" style="color:var(--text-light)">Belum ada approval</td></tr>';

       let laporanHtml = '<p style="color:var(--text-light)">Belum ada laporan.</p>';
       if (laporan) {
              const kunjRows = (laporan.kunjungan || []).map(k =>
                     `<tr><td>${k.tanggal}</td><td>${escHtml(k.nama_instansi)}</td><td>${escHtml(k.nama_kontak)}</td><td>${escHtml(k.nama_pelanggan || '')}</td><td style="white-space:pre-wrap">${escHtml(k.laporan_kunjungan || k.hasil || '')}</td></tr>`
              ).join('') || '<tr><td colspan="5" class="text-center">-</td></tr>';
              const biayaRows = (laporan.biaya || []).map(b =>
                     `<tr><td>${escHtml(b.keterangan)}</td><td>${fmt(b.jumlah)}</td></tr>`
              ).join('') || '<tr><td colspan="2" class="text-center">-</td></tr>';
              const laporanApprRows = (laporan.approvals || []).map(a =>
                     `<tr><td>${LAPORAN_LEVEL_LABELS[a.level] || a.level}</td><td>${escHtml(a.approver_name || '-')}</td>
                      <td><span class="badge badge-${a.status === 'approved' ? 'approved' : 'rejected'}">${a.status}</span></td>
                      <td>${escHtml(a.note || '-')}</td><td>${a.acted_at || '-'}</td></tr>`
              ).join('') || '<tr><td colspan="5" class="text-center">Belum ada</td></tr>';
              laporanHtml = `
              <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:4px">
                <div><strong>Tanggal Laporan:</strong> ${laporan.tanggal_laporan}</div>
                <div><strong>Status:</strong> <span class="badge badge-${laporan.status === 'approved' ? 'approved' : laporan.status === 'rejected' ? 'rejected' : 'pending'}">${laporan.status}</span></div>
                ${laporan.status === 'approved' ? `<a href="/api/sppd/${sppd.id}/laporan/download/pdf" target="_blank" class="btn btn-sm btn-pdf">🖨️ Cetak PDF Laporan</a>` : ''}
              </div>
              <div style="margin-top:8px"><strong>Isi:</strong><br><div style="white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:6px;margin-top:4px">${escHtml(laporan.isi_laporan)}</div></div>
              <div style="margin-top:12px"><strong>Kunjungan:</strong><div class="table-responsive"><table class="table"><thead><tr><th>Tanggal</th><th>Instansi</th><th>Kontak</th><th>Nama Pelanggan</th><th>Laporan Kunjungan</th></tr></thead><tbody>${kunjRows}</tbody></table></div></div>
              <div style="margin-top:12px"><strong>Biaya:</strong><div class="table-responsive"><table class="table"><thead><tr><th>Keterangan</th><th>Jumlah</th></tr></thead><tbody>${biayaRows}</tbody><tfoot><tr><td class="fw-bold">Total</td><td class="fw-bold">${fmt(laporan.total_biaya)}</td></tr></tfoot></table></div></div>
              <div style="margin-top:12px"><strong>Approval Laporan:</strong><div class="table-responsive"><table class="table"><thead><tr><th>Level</th><th>Approver</th><th>Status</th><th>Catatan</th><th>Waktu</th></tr></thead><tbody>${laporanApprRows}</tbody></table></div></div>`;
       }

       const pencStatusBadge = s => ({ belum_cair: '<span class="badge badge-pending">🔴 Belum Cair</span>', dalam_proses: '<span class="badge badge-info">🟡 Dalam Proses</span>', sudah_cair: '<span class="badge badge-approved">🟢 Sudah Cair</span>' }[s] || s);
       let pencairanHtml = '<p style="color:var(--text-light)">Belum ada data pencairan. Akan dibuat otomatis setelah laporan disetujui penuh.</p>';
       if (pencairan) {
              const pLvlLabel = PENCAIRAN_LEVEL_LABELS[pencairan.pencairan_approval_level] || `Lv ${pencairan.pencairan_approval_level}`;
              const pProgressBadge = pencairan.status === 'sudah_cair'
                     ? '<span class="badge badge-approved">✅ Selesai</span>'
                     : pencairan.status === 'ditolak'
                            ? '<span class="badge badge-rejected">❌ Ditolak</span>'
                            : `<span class="badge badge-pending">⏳ Menunggu ${pLvlLabel}</span>`;
              const pencApprRows = (pencairan.approvals || []).map(a =>
                     `<tr><td>${PENCAIRAN_LEVEL_LABELS[a.level] || a.level}</td><td>${escHtml(a.approver_name || '-')}</td>
                      <td><span class="badge badge-${a.status === 'approved' ? 'approved' : 'rejected'}">${a.status}</span></td>
                      <td>${escHtml(a.note || '-')}</td><td>${a.acted_at || '-'}</td></tr>`
              ).join('') || '<tr><td colspan="5" class="text-center">Belum ada</td></tr>';
              pencairanHtml = `
              <div class="form-row" style="gap:16px;flex-wrap:wrap">
                <div><strong>Uang Muka:</strong> ${fmt(pencairan.jumlah_usulan)}</div>
                <div><strong>Realisasi Biaya:</strong> ${fmt(pencairan.jumlah_realisasi)}</div>
                <div><strong>Dicairkan:</strong> ${fmt(pencairan.jumlah_dicairkan)}</div>
                <div><strong>Status:</strong> ${pencStatusBadge(pencairan.status)}</div>
                <div><strong>Progress:</strong> ${pProgressBadge}</div>
              </div>
              ${pencairan.catatan ? `<div style="margin-top:6px"><strong>Catatan:</strong> ${escHtml(pencairan.catatan)}</div>` : ''}
              ${pencairan.updated_by_name ? `<div style="margin-top:4px;font-size:12px;color:var(--text-light)">Diperbarui oleh: ${escHtml(pencairan.updated_by_name)} pada ${pencairan.updated_at}</div>` : ''}
              <div style="margin-top:12px"><strong>Approval Pencairan:</strong><div class="table-responsive"><table class="table"><thead><tr><th>Level</th><th>Approver</th><th>Status</th><th>Catatan</th><th>Waktu</th></tr></thead><tbody>${pencApprRows}</tbody></table></div></div>`;
       }

       return `
       <div class="form-row" style="gap:24px;margin-bottom:16px">
         <div><strong>Nomor:</strong> ${escHtml(sppd.nomor)}</div>
         <div><strong>Status:</strong> ${sppdStatusBadge(sppd)}</div>
         <div><strong>Progress:</strong> ${renderSPPDProgressBadge(sppd)}</div>
       </div>
       <div class="form-row" style="gap:24px;margin-bottom:12px">
         <div><strong>Nama Pegawai:</strong> ${escHtml(sppd.nama_pegawai)}</div>
         <div><strong>Jabatan:</strong> ${escHtml(sppd.jabatan || '-')}</div>
         <div><strong>Area Kerja:</strong> ${escHtml(sppd.area_kerja || '-')}</div>
       </div>
       <div style="margin-bottom:12px">
         <strong>Keperluan:</strong> ${escHtml(sppd.keperluan)}
       </div>
       <div class="form-row" style="gap:24px;margin-bottom:12px">
         <div><strong>Tujuan:</strong> ${escHtml(sppd.tujuan)}</div>
         <div><strong>Transport:</strong> ${escHtml(sppd.transport || '-')}</div>
         <div><strong>Berangkat:</strong> ${sppd.tanggal_berangkat}</div>
         <div><strong>Kembali:</strong> ${sppd.tanggal_kembali}</div>
       </div>
       <div style="margin-bottom:16px"><strong>Uang Muka:</strong> ${fmt(sppd.uang_muka)}</div>
       ${sppd.reject_reason ? `<div class="alert alert-error" style="margin-bottom:12px"><strong>Alasan Penolakan:</strong> ${escHtml(sppd.reject_reason)}</div>` : ''}

       <div class="card" style="margin-bottom:16px">
         <div class="card-header"><h4>📍 Rencana Kunjungan</h4></div>
         <div class="card-body no-padding"><div class="table-responsive"><table class="table">
           <thead><tr><th>Tanggal</th><th>Lokasi</th><th>Pelanggan/Instansi</th><th>Aktivitas</th><th>Target Nilai</th><th>Produk</th></tr></thead>
           <tbody>${itinRows}</tbody>
         </table></div></div>
       </div>

       ${sppd.biaya ? `
       <div class="card" style="margin-bottom:16px">
         <div class="card-header"><h4>💰 Usulan Biaya</h4></div>
         <div class="card-body">
           <div class="form-row" style="gap:24px;flex-wrap:wrap">
             ${sppd.biaya.akomodasi ? `<div><strong>Akomodasi:</strong> ${fmt(sppd.biaya.akomodasi)}</div>` : ''}
             ${sppd.biaya.konsumsi ? `<div><strong>Konsumsi:</strong> ${fmt(sppd.biaya.konsumsi)}</div>` : ''}
             ${sppd.biaya.transportasi ? `<div><strong>Transportasi:</strong> ${fmt(sppd.biaya.transportasi)}</div>` : ''}
             ${sppd.biaya.entertain ? `<div><strong>Entertain:</strong> ${fmt(sppd.biaya.entertain)}</div>` : ''}
             ${sppd.biaya.uang_saku ? `<div><strong>Uang Saku:</strong> ${fmt(sppd.biaya.uang_saku)}</div>` : ''}
             ${sppd.biaya.biaya_lain ? `<div><strong>Lain-lain:</strong> ${fmt(sppd.biaya.biaya_lain)}${sppd.biaya.biaya_lain_ket ? ` (${escHtml(sppd.biaya.biaya_lain_ket)})` : ''}</div>` : ''}
           </div>
           <div style="margin-top:10px;font-weight:bold">Total Usulan: ${fmt(sppd.biaya.total)}</div>
         </div>
       </div>` : ''}

       <div class="card" style="margin-bottom:16px">
         <div class="card-header"><h4>📋 History Approval SPPD</h4></div>
         <div class="card-body no-padding"><div class="table-responsive"><table class="table">
           <thead><tr><th>Level</th><th>Approver</th><th>Status</th><th>Catatan</th><th>Waktu</th></tr></thead>
           <tbody>${approvalRows}</tbody>
         </table></div></div>
       </div>

       <div class="card" style="margin-bottom:16px">
         <div class="card-header"><h4>📝 Laporan Perjalanan Dinas</h4></div>
         <div class="card-body">${laporanHtml}</div>
       </div>

       <div class="card">
         <div class="card-header"><h4>💰 Pencairan Dana</h4></div>
         <div class="card-body">${pencairanHtml}</div>
       </div>`;
}

// ── Approve / Reject SPPD ─────────────────────────────────────────────────────
let sppdActionId = null;
let sppdActionType = null;

function openSPPDAction(id, type) {
       sppdActionId = id;
       sppdActionType = type;
       document.getElementById('sppd-action-title').textContent = type === 'approve' ? '✅ Setujui SPPD' : '❌ Tolak SPPD';
       document.getElementById('sppd-action-note').value = '';
       document.getElementById('sppd-action-error').style.display = 'none';
       document.getElementById('sppd-action-footer').innerHTML = `
              <button onclick="confirmSPPDAction()" class="btn btn-${type === 'approve' ? 'success' : 'danger'}">
                     ${type === 'approve' ? '✅ Ya, Setujui' : '❌ Ya, Tolak'}
              </button>
              <button onclick="closeModal('modal-sppd-action')" class="btn btn-outline">Batal</button>`;
       showModal('modal-sppd-action');
}

async function confirmSPPDAction() {
       const errEl = document.getElementById('sppd-action-error');
       errEl.style.display = 'none';
       const note = document.getElementById('sppd-action-note').value;
       try {
              const res = await api(`/api/sppd/${sppdActionId}/${sppdActionType}`, 'POST', { note });
              const data = await res.json();
              if (!res.ok) { errEl.textContent = data.error || 'Gagal'; errEl.style.display = 'block'; return; }
              closeModal('modal-sppd-action');
              closeModal('modal-sppd-detail');
              showToast(sppdActionType === 'approve' ? 'SPPD disetujui!' : 'SPPD ditolak!', 'success');
              refreshSPPDList();
       } catch { errEl.textContent = 'Koneksi gagal'; errEl.style.display = 'block'; }
}

// ── Laporan Form ──────────────────────────────────────────────────────────────
let laporanTargetSppdId = null;

function openLaporanForm(sppdId) {
       laporanTargetSppdId = sppdId;
       document.getElementById('laporan-tanggal').value = new Date().toISOString().slice(0, 10);
       document.getElementById('laporan-isi').value = '';
       document.getElementById('laporan-kunjungan-tbody').innerHTML = '';
       document.getElementById('laporan-biaya-tbody').innerHTML = '';
       document.getElementById('laporan-total-biaya').textContent = 'Rp 0';
       laporanKunjunganRowCount = 0;
       laporanBiayaRowCount = 0;
       document.getElementById('laporan-error').style.display = 'none';
       document.getElementById('laporan-sppd-title').textContent = 'Laporan Perjalanan Dinas';
       document.getElementById('laporan-sppd-footer').innerHTML = `
              <button onclick="submitLaporanSPPD()" class="btn btn-primary">📤 Kirim Laporan</button>
              <button onclick="closeModal('modal-laporan-sppd')" class="btn btn-outline">Batal</button>`;
       addLaporanKunjunganRow();
       addLaporanBiayaRow();
       showModal('modal-laporan-sppd');
}

function addLaporanKunjunganRow() {
       laporanKunjunganRowCount++;
       const n = laporanKunjunganRowCount;
       const tbody = document.getElementById('laporan-kunjungan-tbody');
       const tr = document.createElement('tr');
       tr.id = `lk-row-${n}`;
       tr.innerHTML = `
              <td><input type="date" class="lk-tgl" style="width:100%"></td>
              <td><input type="text" class="lk-instansi" placeholder="Nama instansi" style="width:100%"></td>
              <td><input type="text" class="lk-kontak" placeholder="Nama kontak" style="width:100%"></td>
              <td><input type="text" class="lk-pelanggan" placeholder="Nama pelanggan" style="width:100%"></td>
              <td><textarea class="lk-laporan" rows="2" placeholder="Laporan kunjungan..." style="width:100%"></textarea></td>
              <td><button type="button" onclick="document.getElementById('lk-row-${n}').remove()" class="btn btn-sm btn-danger">✕</button></td>`;
       tbody.appendChild(tr);
}

function addLaporanBiayaRow() {
       laporanBiayaRowCount++;
       const n = laporanBiayaRowCount;
       const tbody = document.getElementById('laporan-biaya-tbody');
       const tr = document.createElement('tr');
       tr.id = `lb-row-${n}`;
       tr.innerHTML = `
              <td><input type="text" class="lb-ket" placeholder="Keterangan biaya" style="width:100%"></td>
              <td><input type="number" class="lb-jml" min="0" value="0" style="width:100%" oninput="updateLaporanTotal()"></td>
              <td><button type="button" onclick="document.getElementById('lb-row-${n}').remove();updateLaporanTotal();" class="btn btn-sm btn-danger">✕</button></td>`;
       tbody.appendChild(tr);
}

function updateLaporanTotal() {
       let total = 0;
       document.querySelectorAll('#laporan-biaya-tbody .lb-jml').forEach(inp => { total += Number(inp.value) || 0; });
       const fmt = v => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v);
       document.getElementById('laporan-total-biaya').textContent = fmt(total);
}

async function submitLaporanSPPD() {
       const errEl = document.getElementById('laporan-error');
       errEl.style.display = 'none';
       const kunjungan = [];
       document.querySelectorAll('#laporan-kunjungan-tbody tr').forEach(tr => {
              kunjungan.push({
                     tanggal: tr.querySelector('.lk-tgl')?.value || '',
                     nama_instansi: tr.querySelector('.lk-instansi')?.value || '',
                     nama_kontak: tr.querySelector('.lk-kontak')?.value || '',
                     nama_pelanggan: tr.querySelector('.lk-pelanggan')?.value || '',
                     laporan_kunjungan: tr.querySelector('.lk-laporan')?.value || '',
              });
       });
       const biaya = [];
       document.querySelectorAll('#laporan-biaya-tbody tr').forEach(tr => {
              biaya.push({ keterangan: tr.querySelector('.lb-ket')?.value || '', jumlah: Number(tr.querySelector('.lb-jml')?.value) || 0 });
       });
       const body = {
              tanggal_laporan: document.getElementById('laporan-tanggal').value,
              isi_laporan: document.getElementById('laporan-isi').value,
              kunjungan, biaya,
       };
       try {
              const res = await api(`/api/sppd/${laporanTargetSppdId}/laporan`, 'POST', body);
              const data = await res.json();
              if (!res.ok) { errEl.textContent = data.error || 'Gagal'; errEl.style.display = 'block'; return; }
              closeModal('modal-laporan-sppd');
              showToast('Laporan berhasil dikirim!', 'success');
              viewSPPDDetail(laporanTargetSppdId);
       } catch { errEl.textContent = 'Koneksi gagal'; errEl.style.display = 'block'; }
}

// ── Approve/Reject Laporan & Pencairan ────────────────────────────────────────
let laporanActionSppdId = null;
let laporanActionType = null;

function openLaporanAction(sppdId, _, type) {
       laporanActionSppdId = sppdId;
       laporanActionType = type;
       const isApprove = type === 'approve';
       document.getElementById('laporan-action-title').textContent = isApprove ? '✅ Setujui Laporan' : '❌ Tolak Laporan';
       document.getElementById('laporan-action-pencairan-fields').style.display = 'none';
       document.getElementById('laporan-action-note').value = '';
       document.getElementById('laporan-action-error').style.display = 'none';
       document.getElementById('laporan-action-footer').innerHTML = `
              <button onclick="confirmLaporanAction()" class="btn btn-${isApprove ? 'success' : 'danger'}">
                     ${isApprove ? '✅ Ya, Setujui' : '❌ Ya, Tolak'}
              </button>
              <button onclick="closeModal('modal-laporan-action')" class="btn btn-outline">Batal</button>`;
       showModal('modal-laporan-action');
}

async function confirmLaporanAction() {
       const errEl = document.getElementById('laporan-action-error');
       errEl.style.display = 'none';
       const note = document.getElementById('laporan-action-note').value;
       const isApprove = laporanActionType === 'approve';
       const url = `/api/sppd/${laporanActionSppdId}/laporan/${isApprove ? 'approve' : 'reject'}`;
       const body = { note };
       try {
              const res = await api(url, 'POST', body);
              const data = await res.json();
              if (!res.ok) { errEl.textContent = data.error || 'Gagal'; errEl.style.display = 'block'; return; }
              closeModal('modal-laporan-action');
              showToast(isApprove ? 'Laporan disetujui!' : 'Laporan ditolak!', 'success');
              viewSPPDDetail(laporanActionSppdId);
       } catch { errEl.textContent = 'Koneksi gagal'; errEl.style.display = 'block'; }
}

// ============================================================
//  PROFIL SAYA
// ============================================================

async function loadProfile() {
       const msgEl = document.getElementById('profile-msg');
       msgEl.style.display = 'none';
       try {
              const res = await api('/api/sppd/profile');
              if (!res.ok) return;
              const user = await res.json();
              document.getElementById('profile-username').value = user.username;
              document.getElementById('profile-role-display').value = ROLE_LABELS[user.role] || user.role;
              document.getElementById('profile-full-name').value = user.full_name || '';
              document.getElementById('profile-jabatan-detail').value = user.jabatan_detail || '';
              document.getElementById('profile-area-kerja').value = user.area_kerja || '';
              loadMyTTDPreview(user.id);
       } catch (e) { console.error(e); }
}

function loadMyTTDPreview(userId) {
       const img = document.getElementById('my-ttd-preview');
       const placeholder = document.getElementById('my-ttd-placeholder');
       const uid = userId || (currentUser && currentUser.id);
       if (!uid) return;
       const t = Date.now();
       img.onload = () => { img.style.display = ''; placeholder.style.display = 'none'; };
       img.onerror = () => {
              const fallback = `/uploads/ttd_u${uid}.png?t=${t}`;
              if (!img.src.includes('/uploads/')) {
                     img.src = fallback;
              } else {
                     img.style.display = 'none'; placeholder.style.display = 'flex';
              }
       };
       img.src = `/img/ttd_u${uid}.png?t=${t}`;
}

async function saveProfile() {
       const msgEl = document.getElementById('profile-msg');
       msgEl.style.display = 'none';
       const full_name = document.getElementById('profile-full-name').value.trim();
       if (!full_name) {
              msgEl.className = 'alert alert-error';
              msgEl.textContent = 'Nama lengkap tidak boleh kosong';
              msgEl.style.display = 'block';
              return;
       }
       const body = {
              full_name,
              jabatan_detail: document.getElementById('profile-jabatan-detail').value,
              area_kerja: document.getElementById('profile-area-kerja').value,
       };
       try {
              const res = await api('/api/sppd/profile', 'PUT', body);
              const data = await res.json();
              if (!res.ok) {
                     msgEl.className = 'alert alert-error';
                     msgEl.textContent = data.error || 'Gagal menyimpan';
              } else {
                     currentUser.full_name = full_name;
                     document.getElementById('user-name').textContent = full_name;
                     document.getElementById('user-avatar').textContent = full_name.charAt(0).toUpperCase();
                     document.getElementById('top-bar-user').textContent = full_name;
                     msgEl.className = 'alert alert-success';
                     msgEl.textContent = 'Profil berhasil disimpan!';
              }
              msgEl.style.display = 'block';
              setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
       } catch {
              msgEl.className = 'alert alert-error';
              msgEl.textContent = 'Koneksi gagal';
              msgEl.style.display = 'block';
       }
}

async function uploadMyTTD(input) {
       const msgEl = document.getElementById('my-ttd-upload-msg');
       msgEl.style.display = 'none';
       if (!input.files || !input.files[0]) return;
       const formData = new FormData();
       formData.append('ttd', input.files[0]);
       try {
              const res = await fetch('/api/submissions/meta/upload/my-ttd', {
                     method: 'POST',
                     body: formData,
                     credentials: 'same-origin',
              });
              const data = await res.json();
              if (!res.ok) {
                     msgEl.className = 'alert alert-error';
                     msgEl.textContent = data.error || 'Upload gagal';
              } else {
                     msgEl.className = 'alert alert-success';
                     msgEl.textContent = 'Tanda tangan berhasil diupload!';
                     loadMyTTDPreview(currentUser.id);
              }
              msgEl.style.display = 'block';
              setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
              input.value = '';
       } catch {
              msgEl.className = 'alert alert-error';
              msgEl.textContent = 'Koneksi gagal';
              msgEl.style.display = 'block';
       }
}
