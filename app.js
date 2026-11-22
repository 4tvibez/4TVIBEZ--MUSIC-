const audio = document.getElementById('audioPlayer');
const audioInput = document.getElementById('audioInput');
const trackRows = document.getElementById('trackRows');
const toast = document.getElementById('toast');
const tracks = [];
let currentIndex = -1;
let repeat = false;
let shuffle = false;
let toastTimer;

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function timeFormat(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return mins + ':' + secs;
}
function renderTracks() {
  if (!tracks.length) {
    trackRows.innerHTML = '<tr class="empty-row"><td colspan="5"><span class="empty-icon">♫</span><strong>Your music starts here.</strong><span>Add audio files from your device to play them in your library.</span><button class="outline-button" id="emptyUpload">＋ Add your first track</button></td></tr>';
    document.getElementById('emptyUpload').addEventListener('click', openPicker);
    return;
  }
  trackRows.innerHTML = tracks.map((track, index) => '<tr data-index="' + index + '"><td>' + String(index + 1).padStart(2, '0') + '</td><td><div class="track-name"><span class="track-cover">♫</span><div><strong>' + escapeHTML(track.title) + '</strong><small>Local music</small></div></div></td><td>' + escapeHTML(track.artist) + '</td><td>' + (track.duration || '—') + '</td><td><button class="row-play" data-play="' + index + '" aria-label="Play ' + escapeHTML(track.title) + '">▶</button></td></tr>').join('');
  trackRows.querySelectorAll('[data-play]').forEach(button => button.addEventListener('click', () => playTrack(Number(button.dataset.play))));
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function openPicker() { audioInput.click(); }
function addFiles(fileList) {
  const files = Array.from(fileList).filter(file => file.type.startsWith('audio/'));
  if (!files.length) { notify('Choose an audio file to add.'); return; }
  files.forEach(file => {
    const url = URL.createObjectURL(file);
    const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
    tracks.push({ title, artist: 'Your device', url, file, duration: '' });
    const item = tracks[tracks.length - 1];
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = url;
    probe.addEventListener('loadedmetadata', () => { item.duration = timeFormat(probe.duration); renderTracks(); }, { once: true });
  });
  renderTracks();
  notify(files.length + (files.length === 1 ? ' track added to your library.' : ' tracks added to your library.'));
  if (currentIndex === -1) playTrack(tracks.length - files.length);
  audioInput.value = '';
}
function playTrack(index) {
  if (!tracks[index]) return;
  currentIndex = index;
  audio.src = tracks[index].url;
  audio.play().then(() => {
    document.getElementById('playButton').textContent = 'Ⅱ';
    document.getElementById('nowTitle').textContent = tracks[index].title;
    document.getElementById('nowArtist').textContent = tracks[index].artist;
    document.getElementById('miniCover').textContent = '♫';
    renderTracks();
  }).catch(() => notify('Playback could not start. Try selecting the track again.'));
}
function togglePlay() {
  if (currentIndex < 0) { if (tracks.length) playTrack(0); else openPicker(); return; }
  if (audio.paused) audio.play().then(() => document.getElementById('playButton').textContent = 'Ⅱ');
  else { audio.pause(); document.getElementById('playButton').textContent = '▶'; }
}
function nextTrack() {
  if (!tracks.length) return;
  const next = shuffle ? Math.floor(Math.random() * tracks.length) : (currentIndex + 1) % tracks.length;
  playTrack(next);
}
function previousTrack() {
  if (!tracks.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  playTrack((currentIndex - 1 + tracks.length) % tracks.length);
}
['uploadSide','uploadTop','uploadHero','artistUpload','emptyUpload'].forEach(id => {
  const button = document.getElementById(id);
  if (button) button.addEventListener('click', openPicker);
});
audioInput.addEventListener('change', event => addFiles(event.target.files));
document.getElementById('playButton').addEventListener('click', togglePlay);
document.getElementById('nextButton').addEventListener('click', nextTrack);
document.getElementById('previousButton').addEventListener('click', previousTrack);
document.getElementById('shuffleButton').addEventListener('click', event => {
  shuffle = !shuffle; event.currentTarget.classList.toggle('active', shuffle);
  notify(shuffle ? 'Shuffle is on.' : 'Shuffle is off.');
});
document.getElementById('repeatButton').addEventListener('click', event => {
  repeat = !repeat; audio.loop = repeat; event.currentTarget.classList.toggle('active', repeat);
  notify(repeat ? 'Repeat is on.' : 'Repeat is off.');
});
document.getElementById('progress').addEventListener('input', event => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(event.target.value) / 100) * audio.duration;
});
audio.addEventListener('timeupdate', () => {
  document.getElementById('currentTime').textContent = timeFormat(audio.currentTime);
  document.getElementById('progress').value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
});
audio.addEventListener('loadedmetadata', () => document.getElementById('duration').textContent = timeFormat(audio.duration));
audio.addEventListener('ended', () => { if (!repeat) nextTrack(); });
audio.addEventListener('play', () => document.getElementById('playButton').textContent = 'Ⅱ');
audio.addEventListener('pause', () => document.getElementById('playButton').textContent = '▶');
document.getElementById('volume').addEventListener('input', event => audio.volume = Number(event.target.value));
document.getElementById('favoriteButton').addEventListener('click', event => {
  event.currentTarget.classList.toggle('liked');
  event.currentTarget.textContent = event.currentTarget.classList.contains('liked') ? '♥' : '♡';
  notify(event.currentTarget.classList.contains('liked') ? 'Added to favourites (this session).' : 'Removed from favourites.');
});
document.getElementById('createPlaylist').addEventListener('click', () => {
  const name = prompt('Name your playlist:');
  if (!name || !name.trim()) return;
  const link = document.createElement('a');
  link.href = '#libraryView'; link.textContent = '♫  ' + name.trim();
  document.getElementById('playlistList').appendChild(link);
  notify('Playlist created for this session.');
});
document.getElementById('searchInput').addEventListener('input', event => {
  const query = event.target.value.toLowerCase().trim();
  trackRows.querySelectorAll('tr[data-index]').forEach(row => {
    const track = tracks[Number(row.dataset.index)];
    row.hidden = !((track.title + ' ' + track.artist).toLowerCase().includes(query));
  });
});
document.getElementById('exploreButton').addEventListener('click', () => document.getElementById('discoverView').scrollIntoView({behavior:'smooth'}));
document.getElementById('viewAll').addEventListener('click', () => document.getElementById('libraryView').scrollIntoView({behavior:'smooth'}));
document.querySelectorAll('.mood-card').forEach(card => card.addEventListener('click', () => {
  document.getElementById('searchInput').value = '';
  notify(card.dataset.mood + ' mood selected. Add tracks to build this collection.');
}));
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => {
  document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('active'));
  link.classList.add('active');
  const target = link.dataset.view === 'home' ? 'homeView' : link.dataset.view === 'discover' ? 'discoverView' : 'libraryView';
  document.getElementById(target).scrollIntoView({behavior:'smooth'});
  document.getElementById('sidebar').classList.remove('open');
}));
document.getElementById('mobileMenu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('goBack').addEventListener('click', () => history.back());
document.getElementById('goForward').addEventListener('click', () => history.forward());
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('searchInput').focus(); }
  if (event.code === 'Space' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); togglePlay(); }
});
renderTracks();