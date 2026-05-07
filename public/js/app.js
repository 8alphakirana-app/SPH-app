/* ============================================================
   SPH App - Frontend JavaScript
============================================================ */

let currentUser      = null;
let rejectTargetId   = null;
let productRowCount  = 0;
let editTargetId     = null;
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
            const res  = await api('/api/auth/login', 'POST', { username, password });
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

function setUser(user) {
     currentUser = user;
     document.getElementById('user-name').textContent  = user.full_name;
     document.getElementById('user-role').textContent  = user.role === 'admin' ? '👑 Admin' : '👤 Staff';
     document.getElementById('user-avatar').textContent = user.full_name.charAt(0).toUpperCase();
     document.getElementById('top-bar-user').textContent = user.full_name;
     if (user.role === 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
     }
}

// ===================== NAVIGATION =====================
function showLogin() {
     document.getElementById('page-login').style.display = '';
     document.getElementById('page-app').style.display   = 'none';
}

function showApp() {
     document.getElementById('page-login').style.display = 'none';
     document.getElementById('page-app').style.display   = 'flex';
}

function showPage(page) {
     document.querySelectorAll('.content-page').forEach(el => el.style.display = 'none');
     document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
     const target = document.getElementById(`content-${page}`);
     if (target) target.style.display = '';
     const menuItem = document.querySelector(`[data-page="${page}"]`);
     if (menuItem) menuItem.classList.add('active');
     const titles = {
            'dashboard':         'Dashboard',
            'new-submission':    'Buat Pengajuan Baru',
            'my-submissions':    'Pengajuan Saya',
            'admin-submissions': 'Semua Pengajuan',
            'admin-users':       'Kelola Pengguna',
            'admin-settings':    'Pengaturan',
     };
     document.getElementById('top-bar-title').textContent = titles[page] || page;
     if (page === 'dashboard')         loadDashboard();
     else if (page === 'new-submission')    initNewSubmission();
     else if (page === 'my-submissions')    loadMySubmissions();
     else if (page === 'admin-submissions') loadAdminSubmissions();
     else if (page === 'admin-users')       loadUsers();
     else if (page === 'admin-settings')    loadSettings();
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
            if (currentUser.role === 'admin') {
                     await loadDashboardAdmin();
            } else {
                     await loadDashboardStaff();
            }
     } catch (e) {
            console.error(e);
     }
}

async function loadDashboardAdmin() {
     const month = document.getElementById('dash-filter-month')?.value || '';
     const url   = '/api/submissions/dashboard-stats' + (month ? '?month=' + month : '');
     const res   = await api(url);
     const data  = await res.json();
     const { summary, per_user, available_months } = data;

     populateDashMonthFilter(available_months, month);

     document.getElementById('stat-total').textContent    = summary.total;
     document.getElementById('stat-pending').textContent  = summary.menunggu;
     document.getElementById('stat-approved').textContent = summary.disetujui;
     document.getElementById('stat-rejected').textContent = summary.ditolak;
     document.getElementById('stat-products').textContent = summary.jumlah_produk;
     document.getElementById('stat-clients').textContent  = summary.jumlah_pelanggan;

     const zipBtn = document.getElementById('btn-download-zip');
     if (zipBtn) zipBtn.style.display = (month && summary.disetujui > 0) ? '' : 'none';

     const card      = document.getElementById('card-per-user');
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

     const subsRes     = await api('/api/submissions');
     const allSubs     = await subsRes.json();
     const filtered    = month ? allSubs.filter(s => s.created_at && s.created_at.startsWith(month)) : allSubs;
     const recent      = filtered.slice(0, 5);
     const recentEl    = document.getElementById('recent-submissions');
     recentEl.innerHTML = recent.length === 0 ? emptyState('Belum ada pengajuan') : renderSubmissionTable(recent, false);
}

async function loadDashboardStaff() {
     const res         = await api('/api/submissions');
     const submissions = await res.json();

     const monthsSet = new Set();
     submissions.forEach(s => { if (s.created_at) monthsSet.add(s.created_at.substring(0, 7)); });
     const availableMonths = Array.from(monthsSet).sort().reverse();
     populateDashMonthFilter(availableMonths, document.getElementById('dash-filter-month')?.value || '');

     const month    = document.getElementById('dash-filter-month')?.value || '';
     const filtered = month ? submissions.filter(s => s.created_at && s.created_at.startsWith(month)) : submissions;

     const total    = filtered.length;
     const pending  = filtered.filter(s => s.status === 'pending').length;
     const approved = filtered.filter(s => s.status === 'approved').length;
     const rejected = filtered.filter(s => s.status === 'rejected').length;
     let produk = 0;
     const pelSet = new Set();
     filtered.forEach(s => {
            const items = Array.isArray(s.items) ? s.items : [];
            produk += items.length;
            if (s.client_name) pelSet.add(s.client_name);
     });

     document.getElementById('stat-total').textContent    = total;
     document.getElementById('stat-pending').textContent  = pending;
     document.getElementById('stat-approved').textContent = approved;
     document.getElementById('stat-rejected').textContent = rejected;
     document.getElementById('stat-products').textContent = produk;
     document.getElementById('stat-clients').textContent  = pelSet.size;

     const card = document.getElementById('card-per-user');
     if (card) card.style.display = 'none';
     const zipBtn = document.getElementById('btn-download-zip');
     if (zipBtn) zipBtn.style.display = 'none';

     const recent   = filtered.slice(0, 5);
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
            const url  = URL.createObjectURL(blob);
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
            const res         = await api('/api/submissions');
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
     const container    = document.getElementById('admin-submissions-list');
     container.innerHTML = '<div class="loading">⏳ Memuat data...</div>';
     const filterStatus = document.getElementById('filter-status')?.value || '';
     try {
            const res  = await api('/api/submissions');
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
                                                                                                                                  ${currentUser.role === 'admin' ? `<button onclick="downloadDoc(${s.id},'docx')" class="btn btn-success btn-sm" title="Unduh Word">⬇️ Word</button>` : ''}
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
            const s   = await res.json();
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
            let footerHTML = '';
            if (s.status === 'approved') {
                     if (currentUser.role === 'admin') {
                                footerHTML += `<button onclick="downloadDoc(${s.id},'docx')" class="btn btn-success">⬇️ Unduh Word</button>`;
                     }
                     footerHTML += `<button onclick="downloadDoc(${s.id},'pdf')" class="btn btn-pdf">📄 Unduh PDF</button>`;
            }
            if (currentUser.role === 'admin' && s.status === 'pending') {
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
     document.getElementById('submit-error').style.display   = 'none';
     document.getElementById('submit-success').style.display = 'none';
     productRowCount = 0;
     document.getElementById('product-tbody').innerHTML = '';
     document.getElementById('grand-total').textContent = 'Rp 0';
     addProductRow();
}

function addProductRow() {
     productRowCount++;
     const idx   = productRowCount;
     const tbody = document.getElementById('product-tbody');
     const tr    = document.createElement('tr');
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
            const qty   = parseFloat(tr.querySelector('[data-field="qty"]')?.value)          || 0;
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
     const okEl  = document.getElementById('submit-success');
     errEl.style.display = 'none';
     okEl.style.display  = 'none';
     const items = [];
     let valid = true;
     document.querySelectorAll('#product-tbody tr').forEach(tr => {
            const item = {
                     nama_produk: tr.querySelector('[data-field="nama_produk"]')?.value?.trim()  || '',
                     pabrikan:    tr.querySelector('[data-field="pabrikan"]')?.value?.trim()     || '',
                     spesifikasi: tr.querySelector('[data-field="spesifikasi"]')?.value?.trim()  || '',
                     qty:         tr.querySelector('[data-field="qty"]')?.value                  || '0',
                     satuan:      tr.querySelector('[data-field="satuan"]')?.value?.trim()       || '',
                     harga_satuan:tr.querySelector('[data-field="harga_satuan"]')?.value         || '0',
                     link:        tr.querySelector('[data-field="link"]')?.value?.trim()         || '',
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
            client_title:    document.getElementById('sub-client-title').value.trim(),
            client_name:     document.getElementById('sub-client-name').value.trim(),
            client_address:  document.getElementById('sub-client-address').value.trim(),
            client_city:     document.getElementById('sub-client-city').value.trim() || 'di Tempat',
            items,
            ppn_included:    document.querySelector('input[name="ppn"]:checked')?.value    === '1',
            ongkir_included: document.querySelector('input[name="ongkir"]:checked')?.value === '1',
            notes:           document.getElementById('sub-notes').value.trim(),
            lampiran:        document.getElementById('sub-lampiran').value.trim(),
     };
     try {
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.disabled    = true;
            submitBtn.textContent = '⏳ Mengirim...';
            const res  = await api('/api/submissions', 'POST', payload);
            const data = await res.json();
            submitBtn.disabled    = false;
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
            const res  = await api(`/api/submissions/${id}/approve`, 'POST');
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
            const res  = await api(`/api/submissions/${rejectTargetId}/reject`, 'POST', { reason });
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
            const blob   = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const ext    = format === 'pdf' ? '.pdf' : '.docx';
            const filename = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]
              || `SPH_${id}${ext}`;
            const a = document.createElement('a');
            a.href     = objUrl;
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
            const res   = await api('/api/submissions/meta/users');
            const users = await res.json();
            const rows  = users.map(u => `
                  <tr>
                          <td>${escHtml(u.username)}</td>
                                  <td>${escHtml(u.full_name)}</td>
                                          <td><span class="badge ${u.role === 'admin' ? 'badge-approved' : 'badge-pending'}">${u.role === 'admin' ? '👑 Admin' : '👤 Staff'}</span></td>
                                                  <td style="font-size:12px;color:var(--text-light)">${formatDate(u.created_at)}</td>
                                                          <td>
                                                                    ${u.id !== currentUser.id
                                                                                  ? `<button onclick="deleteUser(${u.id}, '${escHtml(u.full_name)}')" class="btn btn-danger btn-sm">🗑️ Hapus</button>`
                                                                                  : '<span style="color:var(--text-light);font-size:12px">Akun Anda</span>'}
                                                                                          </td>
                                                                                                </tr>
                                                                                                    `).join('');
            container.innerHTML = `<div class="table-responsive">
                  <table class="table">
                          <thead><tr><th>Username</th><th>Nama</th><th>Role</th><th>Dibuat</th><th>Aksi</th></tr></thead>
                                  <tbody>${rows}</tbody>
                                        </table>
                                            </div>`;
     } catch {
            container.innerHTML = '<div class="alert alert-error">Gagal memuat data</div>';
     }
}

async function addUser() {
     const username  = document.getElementById('new-username').value.trim();
     const password  = document.getElementById('new-password').value.trim();
     const full_name = document.getElementById('new-fullname').value.trim();
     const role      = document.getElementById('new-role').value;
     const errEl     = document.getElementById('add-user-error');
     errEl.style.display = 'none';
     if (!username || !password || !full_name) {
            errEl.textContent = 'Semua field wajib diisi';
            errEl.style.display = 'block';
            return;
     }
     try {
            const res  = await api('/api/submissions/meta/users', 'POST', { username, password, full_name, role });
            const data = await res.json();
            if (res.ok) {
                     showToast('Pengguna berhasil ditambahkan', 'success');
                     closeModal('modal-add-user');
                     loadUsers();
            } else {
                     errEl.textContent = data.error || 'Gagal menambahkan pengguna';
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
            const res      = await api('/api/submissions/meta/settings');
            const settings = await res.json();
            document.getElementById('set-company-name').value       = settings.company_name       || '';
            document.getElementById('set-company-tagline').value    = settings.company_tagline    || '';
            document.getElementById('set-company-address').value    = settings.company_address    || '';
            document.getElementById('set-company-phone').value      = settings.company_phone      || '';
            document.getElementById('set-company-email').value      = settings.company_email      || '';
            document.getElementById('set-company-headoffice').value = settings.company_headoffice || '';
            document.getElementById('set-company-warehouse').value  = settings.company_warehouse  || '';
            document.getElementById('set-signer-name').value        = settings.signer_name        || '';
            document.getElementById('set-signer-title').value       = settings.signer_title       || '';
            document.getElementById('set-nomor-prefix').value       = settings.nomor_prefix       || '';
            const t       = Date.now();
            const logoImg = document.getElementById('logo-preview');
            logoImg.style.display = '';
            logoImg.src = `/img/logo.png?t=${t}`;
            const ttdImg = document.getElementById('ttd-preview');
            ttdImg.style.display = '';
            ttdImg.src = `/img/ttd.png?t=${t}`;
     } catch {
            showToast('Gagal memuat pengaturan', 'error');
     }
}

document.getElementById('form-settings').addEventListener('submit', async (e) => {
     e.preventDefault();
     const msgEl = document.getElementById('settings-msg');
     msgEl.style.display = 'none';
     const payload = {
            company_name:       document.getElementById('set-company-name').value.trim(),
            company_tagline:    document.getElementById('set-company-tagline').value.trim(),
            company_address:    document.getElementById('set-company-address').value.trim(),
            company_phone:      document.getElementById('set-company-phone').value.trim(),
            company_email:      document.getElementById('set-company-email').value.trim(),
            company_headoffice: document.getElementById('set-company-headoffice').value.trim(),
            company_warehouse:  document.getElementById('set-company-warehouse').value.trim(),
            signer_name:        document.getElementById('set-signer-name').value.trim(),
            signer_title:       document.getElementById('set-signer-title').value.trim(),
            nomor_prefix:       document.getElementById('set-nomor-prefix').value.trim(),
     };
     try {
            const res = await api('/api/submissions/meta/settings', 'PUT', payload);
            if (res.ok) {
                     msgEl.textContent = '✅ Pengaturan berhasil disimpan';
                     msgEl.className   = 'alert alert-success';
                     msgEl.style.display = 'block';
                     showToast('Pengaturan disimpan', 'success');
            } else {
                     msgEl.textContent = 'Gagal menyimpan';
                     msgEl.className   = 'alert alert-error';
                     msgEl.style.display = 'block';
            }
     } catch {
            showToast('Koneksi gagal', 'error');
     }
});

// ===================== UPLOAD GAMBAR =====================
async function uploadImage(type, input) {
     const file  = input.files[0];
     if (!file) return;
     const msgEl = document.getElementById(`${type}-upload-msg`);
     msgEl.textContent = '⏳ Mengupload...';
     msgEl.className   = 'alert';
     msgEl.style.display = 'block';
     const formData = new FormData();
     formData.append('image', file);
     try {
            const res  = await fetch(`/api/submissions/meta/upload/${type}`, { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok) {
                     msgEl.textContent = '✅ Berhasil diupload!';
                     msgEl.className   = 'alert alert-success';
                     const img = document.getElementById(`${type}-preview`);
                     img.style.display = '';
                     img.src = data.url;
                     const placeholder = document.getElementById(`${type}-placeholder`);
                     if (placeholder) placeholder.style.display = 'none';
            } else {
                     msgEl.textContent = '❌ ' + (data.error || 'Gagal upload');
                     msgEl.className   = 'alert alert-error';
            }
     } catch {
            msgEl.textContent = '❌ Koneksi gagal';
            msgEl.className   = 'alert alert-error';
     }
     input.value = '';
}

// ===================== EDIT SUBMISSION =====================
async function openEditModal(id) {
     try {
            const res = await api(`/api/submissions/${id}`);
            const s   = await res.json();
            if (!res.ok) { showToast(s.error || 'Gagal memuat data', 'error'); return; }
            editTargetId = id;
            editProductRowCount = 0;
            document.getElementById('edit-client-title').value   = s.client_title   || '';
            document.getElementById('edit-client-name').value    = s.client_name    || '';
            document.getElementById('edit-client-address').value = s.client_address || '';
            document.getElementById('edit-client-city').value    = s.client_city    || 'di Tempat';
            const ppnVal    = s.ppn_included    ? '1' : '0';
            const ongkirVal = s.ongkir_included ? '1' : '0';
            document.querySelector(`input[name="edit-ppn"][value="${ppnVal}"]`).checked    = true;
            document.querySelector(`input[name="edit-ongkir"][value="${ongkirVal}"]`).checked = true;
            document.getElementById('edit-lampiran').value = s.lampiran || '';
            document.getElementById('edit-notes').value    = s.notes    || '';
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
     const idx   = editProductRowCount;
     const tbody = document.getElementById('edit-product-tbody');
     const tr    = document.createElement('tr');
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
            const qty   = parseFloat(tr.querySelector('[data-field="qty"]')?.value)          || 0;
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
                     nama_produk:  tr.querySelector('[data-field="nama_produk"]')?.value?.trim()  || '',
                     pabrikan:     tr.querySelector('[data-field="pabrikan"]')?.value?.trim()     || '',
                     spesifikasi:  tr.querySelector('[data-field="spesifikasi"]')?.value?.trim()  || '',
                     qty:          tr.querySelector('[data-field="qty"]')?.value                  || '0',
                     satuan:       tr.querySelector('[data-field="satuan"]')?.value?.trim()       || '',
                     harga_satuan: tr.querySelector('[data-field="harga_satuan"]')?.value         || '0',
                     link:         tr.querySelector('[data-field="link"]')?.value?.trim()         || '',
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
            client_title:    document.getElementById('edit-client-title').value.trim(),
            client_name:     document.getElementById('edit-client-name').value.trim(),
            client_address:  document.getElementById('edit-client-address').value.trim(),
            client_city:     document.getElementById('edit-client-city').value.trim() || 'di Tempat',
            items,
            ppn_included:    document.querySelector('input[name="edit-ppn"]:checked')?.value    === '1',
            ongkir_included: document.querySelector('input[name="edit-ongkir"]:checked')?.value === '1',
            notes:           document.getElementById('edit-notes').value.trim(),
            lampiran:        document.getElementById('edit-lampiran').value.trim(),
     };
     if (!payload.client_name || !payload.client_address) {
            errEl.textContent = 'Nama instansi dan alamat wajib diisi.';
            errEl.style.display = 'block';
            return;
     }
     try {
            const btn = document.getElementById('btn-save-edit');
            btn.disabled    = true;
            btn.textContent = '⏳ Menyimpan...';
            const res  = await api(`/api/submissions/${editTargetId}`, 'PUT', payload);
            const data = await res.json();
            btn.disabled    = false;
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
            const res  = await api(`/api/submissions/${id}`, 'DELETE');
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
       .replace(/&/g,'&amp;').replace(/</g,'&lt;')
       .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
     t.className   = `toast ${type}`;
     t.style.display = 'block';
     clearTimeout(t._timer);
     t._timer = setTimeout(() => { t.style.display = 'none'; }, 3500);
}
