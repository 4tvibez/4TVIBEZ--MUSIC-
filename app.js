const audio = document.getElementById('audioPlayer');
const audioInput = document.getElementById('audioInput');
const trackRows = document.getElementById('trackRows');
const toast = document.getElementById('toast');

let tracks = [];
let currentIndex = -1;
let repeat = false;
let shuffle = false;
let toastTimer;
let db;
let muted = false;
let previousVolume = 0.8;
let favorites = new Set();
let activeFilter = 'all';
let activeMood = '';
try { favorites = new Set(JSON.parse(localStorage.getItem('4tvibez-favorites') || '[]')); } catch (_) {}

const DB_NAME = 'fourTvibezMusic';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function timeFormat(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  return Math.floor(seconds / 60) + ':' + Math.floor(seconds % 60).toString().padStart(2, '0');
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeTrack(track) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      blob: track.blob
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function getSavedTracks() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function deleteSavedTrack(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function renderTracks() {
  const count = document.getElementById('libraryCount');
  const heading = document.getElementById('libraryHeading');
  const visibleTracks = tracks.map((track, index) => ({ track, index })).filter(({track}) => {
    const text = (track.title + ' ' + track.artist).toLowerCase();
    const matchesFavorite = activeFilter !== 'favorites' || favorites.has(track.id);
    const matchesMood = !activeMood || text.includes(activeMood.toLowerCase());
    return matchesFavorite && matchesMood;
  });
  if (count) count.textContent = visibleTracks.length + (visibleTracks.length === 1 ? ' TRACK' : ' TRACKS') + (activeFilter === 'favorites' ? ' · FAVOURITES' : ' · IN YOUR LIBRARY');
  if (heading) heading.textContent = activeFilter === 'favorites' ? 'Your favourites' : (activeMood ? activeMood + ' picks' : 'Recently added');
  if (!tracks.length) {
    trackRows.innerHTML = '<tr class="empty-row"><td colspan="5"><span class="empty-icon">♫</span><strong>Your music starts here.</strong><span>Add audio files from your device to build your library.</span><button class="outline-button" id="emptyUpload">＋ Add your first track</button></td></tr>';
    document.getElementById('emptyUpload').addEventListener('click', openPicker);
    return;
  }

  if (!visibleTracks.length) {
    trackRows.innerHTML = '<tr class="empty-row"><td colspan="5"><span class="empty-icon">♫</span><strong>' + (activeFilter === 'favorites' ? 'No favourites yet.' : 'No matching tracks yet.') + '</strong><span>' + (activeFilter === 'favorites' ? 'Tap the heart while a song is playing to save it here.' : 'Try another mood or add more music to your library.') + '</span></td></tr>';
    return;
  }

  trackRows.innerHTML = visibleTracks.map(({track, index}) => {
    const active = index === currentIndex;
    return '<tr data-index="' + index + '">' +
      '<td>' + (active ? '♫' : String(index + 1).padStart(2, '0')) + '</td>' +
      '<td><div class="track-name"><span class="track-cover">♫</span><div><strong>' + escapeHTML(track.title) + '</strong><small>' + (active ? 'NOW PLAYING' : (favorites.has(track.id) ? '♥ FAVOURITE · ' : '') + 'SAVED ON THIS DEVICE') + '</small></div></div></td>' +
      '<td>' + escapeHTML(track.artist) + '</td>' +
      '<td>' + (track.duration || '—') + '</td>' +
      '<td><button class="row-play" data-play="' + index + '" aria-label="Play ' + escapeHTML(track.title) + '">▶</button><button class="row-play remove-track" data-remove="' + index + '" aria-label="Remove ' + escapeHTML(track.title) + '">×</button></td>' +
      '</tr>';
  }).join('');

  trackRows.querySelectorAll('[data-play]').forEach(button => {
    button.addEventListener('click', () => playTrack(Number(button.dataset.play)));
  });
  trackRows.querySelectorAll('[data-remove]').forEach(button => {
    button.addEventListener('click', () => removeTrack(Number(button.dataset.remove)));
  });
}


let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingStartedAt = 0;

async function toggleRecording() {
  const button = document.getElementById('recordButton');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    button.disabled = true;
    button.querySelector('span').textContent = 'Saving…';
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    notify('Voice recording is not supported in this browser. Try the latest Chrome over HTTPS.');
    return;
  }

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find(type => MediaRecorder.isTypeSupported(type));
    mediaRecorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
    recordingChunks = [];
    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size) recordingChunks.push(event.data);
    };
    mediaRecorder.onerror = () => {
      notify('The recording stopped because of a microphone error.');
      resetRecorderButton();
      if (recordingStream) recordingStream.getTracks().forEach(track => track.stop());
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      if (recordingStream) recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
      resetRecorderButton();

      if (!blob.size) {
        notify('No audio was captured. Please try again.');
        return;
      }

      const stamp = new Date().toLocaleString();
      const track = {
        id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()),
        title: 'Voice recording ' + stamp,
        artist: 'Recorded by you',
        blob,
        url: URL.createObjectURL(blob),
        duration: timeFormat((Date.now() - recordingStartedAt) / 1000)
      };

      try {
        await storeTrack(track);
        tracks.unshift(track);
        renderTracks();
        notify('Your voice recording is saved in Your Library on this device.');
      } catch (error) {
        URL.revokeObjectURL(track.url);
        console.error('Could not save voice recording:', error);
        notify('Recording finished, but browser storage could not save it.');
      }
    };

    recordingStartedAt = Date.now();
    mediaRecorder.start(250);
    button.classList.add('is-recording');
    button.setAttribute('aria-pressed', 'true');
    button.querySelector('span').textContent = 'Stop recording';
    notify('Recording… speak into your microphone. Tap Stop recording when finished.');
  } catch (error) {
    console.error('Microphone access failed:', error);
    const message = error && error.name === 'NotAllowedError'
      ? 'Microphone permission was denied. Allow microphone access in your browser settings.'
      : 'Could not access the microphone. Check that it is connected and try again.';
    notify(message);
    if (recordingStream) recordingStream.getTracks().forEach(track => track.stop());
    recordingStream = null;
  }
}

function resetRecorderButton() {
  const button = document.getElementById('recordButton');
  button.disabled = false;
  button.classList.remove('is-recording');
  button.setAttribute('aria-pressed', 'false');
  button.querySelector('span').textContent = 'Record';
}

function openPicker() {
  audioInput.click();
}

async function addFiles(fileList) {
  const files = Array.from(fileList).filter(file => file.type.startsWith('audio/'));
  if (!files.length) {
    notify('Choose an audio file to add.');
    return;
  }

  let added = 0;
  for (const file of files) {
    const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
    const track = {
      id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()),
      title,
      artist: 'Your device',
      blob: file,
      url: URL.createObjectURL(file),
      duration: ''
    };

    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = track.url;
    await new Promise(resolve => {
      probe.addEventListener('loadedmetadata', resolve, { once: true });
      probe.addEventListener('error', resolve, { once: true });
    });
    track.duration = timeFormat(probe.duration);

    try {
      await storeTrack(track);
      tracks.push(track);
      added++;
    } catch (error) {
      console.error('Could not save track:', error);
      notify('Browser storage is full or unavailable. Try a smaller audio file.');
    }
  }

  renderTracks();
  if (currentIndex === -1 && tracks.length) {
    playTrack(tracks.length - added);
  }
  if (added) notify(added + (added === 1 ? ' track saved to this browser.' : ' tracks saved to this browser.'));
  audioInput.value = '';
}

async function removeTrack(index) {
  const track = tracks[index];
  if (!track) return;
  const wasPlaying = currentIndex === index;
  if (wasPlaying) {
    audio.pause();
    audio.removeAttribute('src');
    currentIndex = -1;
    document.getElementById('nowTitle').textContent = 'Choose a track';
    document.getElementById('nowArtist').textContent = 'Your music will appear here';
    document.getElementById('playButton').textContent = '▶';
  }
  await deleteSavedTrack(track.id);
  URL.revokeObjectURL(track.url);
  tracks.splice(index, 1);
  if (currentIndex > index) currentIndex--;
  renderTracks();
  notify('Track removed from this browser.');
}

function playTrack(index) {
  if (!tracks[index]) return;
  currentIndex = index;
  audio.src = tracks[index].url;
  document.getElementById('nowTitle').textContent = tracks[index].title;
  document.getElementById('nowArtist').textContent = tracks[index].artist;
  document.getElementById('miniCover').textContent = '♫';
  document.getElementById('favoriteButton').classList.toggle('liked', favorites.has(tracks[index].id));
  document.getElementById('favoriteButton').textContent = favorites.has(tracks[index].id) ? '♥' : '♡';
  renderTracks();
  audio.play().catch(() => notify('Playback could not start. Try selecting the track again.'));
}

function togglePlay() {
  if (currentIndex < 0) {
    if (tracks.length) playTrack(0);
    else openPicker();
    return;
  }
  if (audio.paused) audio.play().catch(() => notify('Playback could not start.'));
  else audio.pause();
}

function nextTrack() {
  if (!tracks.length) return;
  const next = shuffle ? Math.floor(Math.random() * tracks.length) : (currentIndex + 1) % tracks.length;
  playTrack(next);
}

function previousTrack() {
  if (!tracks.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  playTrack((currentIndex - 1 + tracks.length) % tracks.length);
}

function loadPlaylists() {
  let playlists = [];
  try {
    playlists = JSON.parse(localStorage.getItem('4tvibez-playlists') || '[]');
  } catch (_) {}
  const list = document.getElementById('playlistList');
  if (!playlists.length) {
    list.innerHTML = '<p class="muted side-empty">Create a playlist to organise your sound.</p>';
    return;
  }
  list.innerHTML = playlists.map(name => '<a href="#libraryView">♫ &nbsp;' + escapeHTML(name) + '</a>').join('');
}

function createPlaylist() {
  const name = prompt('Name your playlist:');
  if (!name || !name.trim()) return;
  let playlists = [];
  try {
    playlists = JSON.parse(localStorage.getItem('4tvibez-playlists') || '[]');
  } catch (_) {}
  const cleanName = name.trim();
  if (playlists.some(item => item.toLowerCase() === cleanName.toLowerCase())) {
    notify('That playlist already exists.');
    return;
  }
  playlists.push(cleanName);
  localStorage.setItem('4tvibez-playlists', JSON.stringify(playlists));
  loadPlaylists();
  notify('Playlist saved in this browser.');
}

async function initialiseLibrary() {
  try {
    db = await openDatabase();
    const saved = await getSavedTracks();
    tracks = saved.map(track => ({
      ...track,
      url: URL.createObjectURL(track.blob)
    }));
    renderTracks();
    loadPlaylists();
    if (tracks.length) notify(tracks.length + ' saved track(s) loaded.');
  } catch (error) {
    console.error('Library could not be opened:', error);
    notify('This browser could not open local music storage.');
    renderTracks();
  }
}

['uploadSide', 'uploadTop', 'uploadHero', 'artistUpload', 'emptyUpload'].forEach(id => {
  const button = document.getElementById(id);
  if (button) button.addEventListener('click', openPicker);
});
audioInput.addEventListener('change', event => addFiles(event.target.files));
document.getElementById('recordButton').addEventListener('click', toggleRecording);
document.getElementById('playButton').addEventListener('click', togglePlay);
document.getElementById('nextButton').addEventListener('click', nextTrack);
document.getElementById('previousButton').addEventListener('click', previousTrack);

document.getElementById('shuffleButton').addEventListener('click', event => {
  shuffle = !shuffle;
  event.currentTarget.classList.toggle('active', shuffle);
  notify(shuffle ? 'Shuffle is on.' : 'Shuffle is off.');
});

document.getElementById('repeatButton').addEventListener('click', event => {
  repeat = !repeat;
  audio.loop = repeat;
  event.currentTarget.classList.toggle('active', repeat);
  notify(repeat ? 'Repeat is on.' : 'Repeat is off.');
});

document.getElementById('progress').addEventListener('input', event => {
  if (Number.isFinite(audio.duration)) {
    audio.currentTime = (Number(event.target.value) / 100) * audio.duration;
  }
});

audio.addEventListener('timeupdate', () => {
  document.getElementById('currentTime').textContent = timeFormat(audio.currentTime);
  document.getElementById('progress').value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
});
audio.addEventListener('loadedmetadata', () => {
  document.getElementById('duration').textContent = timeFormat(audio.duration);
});
audio.addEventListener('ended', () => {
  if (!repeat) nextTrack();
});
audio.addEventListener('play', () => { document.getElementById('playButton').textContent = 'Ⅱ'; document.querySelector('.player-bar').classList.add('is-playing'); });
audio.addEventListener('pause', () => { document.getElementById('playButton').textContent = '▶'; document.querySelector('.player-bar').classList.remove('is-playing'); });
document.getElementById('volume').addEventListener('input', event => {
  audio.volume = Number(event.target.value);
  muted = audio.volume === 0;
  document.getElementById('muteButton').textContent = muted ? '♪̸' : '♫';
});
document.getElementById('muteButton').addEventListener('click', () => {
  muted = !muted;
  if (muted) { previousVolume = audio.volume || Number(document.getElementById('volume').value) || 0.8; audio.volume = 0; }
  else audio.volume = previousVolume || 0.8;
  document.getElementById('volume').value = audio.volume;
  document.getElementById('muteButton').textContent = muted ? '♪̸' : '♫';
  notify(muted ? 'Sound muted.' : 'Sound restored.');
});

document.getElementById('favoriteButton').addEventListener('click', event => {
  if (currentIndex < 0 || !tracks[currentIndex]) { notify('Play a track before adding a favourite.'); return; }
  const id = tracks[currentIndex].id;
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  localStorage.setItem('4tvibez-favorites', JSON.stringify([...favorites]));
  event.currentTarget.classList.toggle('liked', favorites.has(id));
  event.currentTarget.textContent = favorites.has(id) ? '♥' : '♡';
  renderTracks();
  notify(favorites.has(id) ? 'Added to your favourites.' : 'Removed from your favourites.');
});

document.getElementById('createPlaylist').addEventListener('click', createPlaylist);

document.getElementById('searchInput').addEventListener('input', event => {
  const query = event.target.value.toLowerCase().trim();
  trackRows.querySelectorAll('tr[data-index]').forEach(row => {
    const track = tracks[Number(row.dataset.index)];
    row.hidden = !((track.title + ' ' + track.artist).toLowerCase().includes(query));
  });
  if (query) { document.getElementById('libraryView').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

document.querySelectorAll('.filter-pill').forEach(button => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll('.filter-pill').forEach(item => item.classList.toggle('active', item === button));
    renderTracks();
  });
});

document.getElementById('exploreButton').addEventListener('click', () => {
  document.getElementById('discoverView').scrollIntoView({ behavior: 'smooth' });
});
document.getElementById('viewAll').addEventListener('click', () => {
  document.getElementById('libraryView').scrollIntoView({ behavior: 'smooth' });
});

document.querySelectorAll('.mood-card').forEach(card => {
  card.addEventListener('click', () => {
    const mood = card.dataset.mood;
    activeMood = activeMood === mood ? '' : mood;
    document.querySelectorAll('.mood-card').forEach(item => item.classList.toggle('selected', item.dataset.mood === activeMood));
    activeFilter = 'all';
    document.querySelectorAll('.filter-pill').forEach(item => item.classList.toggle('active', item.dataset.filter === 'all'));
    document.getElementById('searchInput').value = '';
    renderTracks();
    document.getElementById('libraryView').scrollIntoView({ behavior: 'smooth' });
    notify(activeMood ? mood + ' selected. Matching songs in your library are shown.' : 'Mood filter cleared.');
  });
});

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('active'));
    link.classList.add('active');
    const target = link.dataset.view === 'home' ? 'homeView' :
      link.dataset.view === 'discover' ? 'discoverView' : 'libraryView';
    document.getElementById(target).scrollIntoView({ behavior: 'smooth' });
    document.getElementById('sidebar').classList.remove('open');
  });
});

document.getElementById('mobileMenu').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('goBack').addEventListener('click', () => history.back());
document.getElementById('goForward').addEventListener('click', () => history.forward());

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.getElementById('searchInput').focus();
  }
  if (event.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    togglePlay();
  }
});

audio.volume = Number(document.getElementById('volume').value);
initialiseLibrary();