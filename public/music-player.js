import { reactive, watch, nextTick, ref } from 'vue';

const LRC_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(lrc) {
  if (!lrc || typeof lrc !== 'string') return [];
  const out = [];
  const lines = lrc.split(/\r?\n/);
  for (const raw of lines) {
    const text = raw.replace(LRC_TAG, '').trim();
    if (!text) continue;
    LRC_TAG.lastIndex = 0;
    let m;
    while ((m = LRC_TAG.exec(raw)) !== null) {
      const minutes = Number(m[1]);
      const seconds = Number(m[2]);
      const fracStr = m[3] || '';
      const fraction = fracStr ? Number(`0.${fracStr}`) : 0;
      if (Number.isNaN(minutes) || Number.isNaN(seconds)) continue;
      out.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

function mergeBilingual(origLines, transLines) {
  if (!origLines.length) return [];
  const transMap = new Map();
  for (const t of transLines) {
    transMap.set(t.time.toFixed(2), t.text);
  }
  return origLines.map(({ time, text }) => ({
    time,
    original: text,
    translated: transMap.get(time.toFixed(2)) || '',
  }));
}

function findActiveIndex(lines, currentTime) {
  if (!lines.length) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= currentTime + 0.05) idx = i;
    else break;
  }
  return idx;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const audioEl = new Audio();
audioEl.preload = 'metadata';

export const musicPlayerStore = reactive({
  visible: false,
  playlistId: '',
  songs: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  expanded: false,
  lyricLines: [],
  activeLyricIndex: -1,
});

audioEl.addEventListener('timeupdate', () => {
  musicPlayerStore.currentTime = audioEl.currentTime || 0;
  if (musicPlayerStore.lyricLines.length) {
    const idx = findActiveIndex(musicPlayerStore.lyricLines, audioEl.currentTime);
    if (idx !== musicPlayerStore.activeLyricIndex) {
      musicPlayerStore.activeLyricIndex = idx;
    }
  }
});
audioEl.addEventListener('loadedmetadata', () => {
  musicPlayerStore.duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
});
audioEl.addEventListener('play', () => { musicPlayerStore.isPlaying = true; });
audioEl.addEventListener('pause', () => { musicPlayerStore.isPlaying = false; });
audioEl.addEventListener('ended', () => { next(); });
audioEl.addEventListener('error', () => {
  if (musicPlayerStore.currentIndex >= 0) next();
});

export function playAt(index) {
  const songs = musicPlayerStore.songs;
  if (!songs.length) return;
  let target = index;
  while (target >= 0 && target < songs.length && !songs[target]?.playback?.audio_url) {
    target += 1;
  }
  if (target < 0 || target >= songs.length) {
    audioEl.pause();
    musicPlayerStore.isPlaying = false;
    return;
  }
  const song = songs[target];
  musicPlayerStore.currentIndex = target;
  const orig = parseLrc(song.lyric);
  const trans = parseLrc(song.translated_lyric);
  musicPlayerStore.lyricLines = mergeBilingual(orig, trans);
  musicPlayerStore.activeLyricIndex = -1;
  musicPlayerStore.currentTime = 0;
  musicPlayerStore.duration = 0;
  audioEl.src = song.playback.audio_url;
  audioEl.play().catch(() => {});
}

export function loadPlaylist(playlistId, songs, startIndex = 0) {
  if (!Array.isArray(songs) || !songs.length) return;
  musicPlayerStore.playlistId = String(playlistId || '');
  musicPlayerStore.songs = songs.slice();
  musicPlayerStore.visible = true;
  musicPlayerStore.expanded = false;
  const safeStart = Math.max(0, Math.min(Number(startIndex) || 0, songs.length - 1));
  playAt(safeStart);
}

export function togglePlay() {
  if (!musicPlayerStore.songs.length) return;
  if (audioEl.paused) audioEl.play().catch(() => {});
  else audioEl.pause();
}

export function next() {
  const i = musicPlayerStore.currentIndex;
  if (i + 1 < musicPlayerStore.songs.length) {
    playAt(i + 1);
  } else {
    audioEl.pause();
  }
}

export function prev() {
  const i = musicPlayerStore.currentIndex;
  if (i - 1 >= 0) playAt(i - 1);
  else {
    audioEl.currentTime = 0;
  }
}

export function seek(seconds) {
  if (!Number.isFinite(seconds)) return;
  const target = Math.max(0, Math.min(seconds, audioEl.duration || seconds));
  audioEl.currentTime = target;
  musicPlayerStore.currentTime = target;
}

export function close() {
  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.load();
  musicPlayerStore.visible = false;
  musicPlayerStore.playlistId = '';
  musicPlayerStore.songs = [];
  musicPlayerStore.currentIndex = -1;
  musicPlayerStore.lyricLines = [];
  musicPlayerStore.activeLyricIndex = -1;
  musicPlayerStore.currentTime = 0;
  musicPlayerStore.duration = 0;
  musicPlayerStore.isPlaying = false;
  musicPlayerStore.expanded = false;
}

export function toggleExpanded() {
  musicPlayerStore.expanded = !musicPlayerStore.expanded;
}

export const MusicPlayer = {
  setup() {
    const lyricsEl = ref(null);
    const isSeeking = ref(false);
    const seekValue = ref(0);

    watch(() => musicPlayerStore.activeLyricIndex, () => {
      if (!musicPlayerStore.expanded) return;
      nextTick(() => {
        const container = lyricsEl.value;
        if (!container) return;
        const active = container.querySelector('.music-player-lyric-row.active');
        if (!active) return;
        const cHeight = container.clientHeight;
        const aTop = active.offsetTop - container.offsetTop;
        const aHeight = active.offsetHeight;
        const desired = aTop - cHeight / 2 + aHeight / 2;
        container.scrollTo({ top: Math.max(0, desired), behavior: 'smooth' });
      });
    });

    watch(() => musicPlayerStore.expanded, (open) => {
      if (open) {
        nextTick(() => {
          const container = lyricsEl.value;
          const active = container?.querySelector('.music-player-lyric-row.active');
          if (active && container) {
            container.scrollTop = active.offsetTop - container.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2;
          }
        });
      }
    });

    const currentSong = () => {
      const i = musicPlayerStore.currentIndex;
      return i >= 0 ? musicPlayerStore.songs[i] : null;
    };

    return {
      store: musicPlayerStore,
      lyricsEl,
      isSeeking,
      seekValue,
      formatTime,
      currentSong,
      togglePlay,
      next,
      prev,
      close,
      toggleExpanded,
      onSeekStart(e) {
        isSeeking.value = true;
        seekValue.value = Number(e.target.value) || 0;
      },
      onSeekInput(e) {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) seekValue.value = v;
      },
      onSeekEnd(e) {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) seek(v);
        isSeeking.value = false;
      },
      sliderValue() {
        return isSeeking.value ? seekValue.value : musicPlayerStore.currentTime;
      },
      sliderProgressPct() {
        const duration = musicPlayerStore.duration;
        if (!duration) return '0%';
        const v = isSeeking.value ? seekValue.value : musicPlayerStore.currentTime;
        return `${Math.min(100, Math.max(0, (v / duration) * 100))}%`;
      },
      hasPlayableCurrent() {
        const song = currentSong();
        return !!song?.playback?.audio_url;
      },
    };
  },
  template: `
    <section v-show="store.visible" class="music-player-banner" :class="{ expanded: store.expanded }">
      <div class="music-player-row">
        <div class="music-player-meta">
          <img v-if="currentSong() && currentSong().cover" :src="currentSong().cover" class="music-player-cover" alt="" referrerpolicy="no-referrer" />
          <div v-else class="music-player-cover music-player-cover-placeholder"><music-icon /></div>
          <div class="music-player-titles">
            <div class="music-player-title">{{ (currentSong() && currentSong().name) || '—' }}</div>
            <div class="music-player-artist">{{ (currentSong() && (currentSong().artist || currentSong().artists)) || '' }}</div>
          </div>
        </div>
        <div class="music-player-progress">
          <span class="music-player-time">{{ formatTime(sliderValue()) }}</span>
          <input
            type="range"
            min="0"
            :max="store.duration || 0"
            step="0.1"
            :value="sliderValue()"
            :disabled="!store.duration"
            :style="{ '--progress-pct': sliderProgressPct() }"
            @pointerdown="onSeekStart($event)"
            @input="onSeekInput($event)"
            @change="onSeekEnd($event)"
          />
          <span class="music-player-time">{{ formatTime(store.duration) }}</span>
        </div>
        <div class="music-player-controls">
          <button class="icon-btn" type="button" title="上一首" @click="prev"><skip-back-icon /></button>
          <button class="icon-btn music-player-play" type="button" :title="store.isPlaying ? '暂停' : '播放'" :disabled="!hasPlayableCurrent()" @click="togglePlay">
            <component :is="store.isPlaying ? 'pause-icon' : 'play-icon'" />
          </button>
          <button class="icon-btn" type="button" title="下一首" @click="next"><skip-forward-icon /></button>
          <button class="icon-btn" type="button" :title="store.expanded ? '收起歌词' : '展开歌词'" @click="toggleExpanded">
            <component :is="store.expanded ? 'chevron-up-icon' : 'chevron-down-icon'" />
          </button>
          <button class="icon-btn" type="button" title="关闭播放器" @click="close"><x-icon /></button>
        </div>
      </div>
      <div v-show="store.expanded" class="music-player-lyrics" ref="lyricsEl">
        <div v-if="!store.lyricLines.length" class="music-player-lyrics-empty">暂无歌词</div>
        <div
          v-for="(line, i) in store.lyricLines"
          :key="i"
          class="music-player-lyric-row"
          :class="{ active: i === store.activeLyricIndex }"
        >
          <div class="music-player-lyric-original">{{ line.original }}</div>
          <div v-if="line.translated" class="music-player-lyric-translated">{{ line.translated }}</div>
        </div>
      </div>
    </section>
  `,
};
