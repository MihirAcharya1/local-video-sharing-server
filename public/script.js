const API_OPTIONS = [
  { name: 'Jio AirFiber', value: 'https://192.168.31.89:5000' },
  { name: 'IQOO 11 - hotspot', value: 'https://10.74.173.210:5000' },
  { name: 'Realme 1', value: 'https://192.168.31.113:5000' },

];
const UPLOAD_PASSWORD = '1234';
const origin  = String(window.location.href).slice(0, window.location.pathname.length - 1);
console.log('Origin:', origin);
console.log(window)
let apiUrl = origin || API_OPTIONS[2].value;
let videoFile = null;
let videoList = [];

// const apiSelect = document.getElementById('apiSelect');
const videoInput = document.getElementById('videoInput');
const passwordInput = document.getElementById('passwordInput');
const uploadBtn = document.getElementById('uploadBtn');
const chooseBtn = document.getElementById('chooseBtn');
const errorMsg = document.getElementById('errorMsg');
const uploadedVideoContainer = document.getElementById('uploadedVideoContainer');
const videoListContainer = document.getElementById('videoList');

API_OPTIONS.forEach(opt => {
  const option = document.createElement('option');
  option.value = opt.value;
  option.textContent = opt.name;
  // apiSelect.appendChild(option);
});

// apiSelect.addEventListener('change', (e) => {
//   apiUrl = e.target.value;
//   fetchVideos();
// });

chooseBtn.addEventListener('click', () => videoInput.click());

videoInput.addEventListener('change', (e) => {
  videoFile = e.target.files[0];
  chooseBtn.innerHTML = `📁 ${videoFile.name}`;
});

uploadBtn.addEventListener('click', async () => {
  if (passwordInput.value !== UPLOAD_PASSWORD) {
    errorMsg.textContent = '❌ Wrong password';
    return;
  }
  if (!videoFile) {
    errorMsg.textContent = '❌ Please select a video file';
    return;
  }

  const formData = new FormData();
  formData.append('video', videoFile);

  try {
    uploadBtn.disabled = true;
    errorMsg.textContent = '';

    const res = await axios.post(`${apiUrl}/upload`, formData, {
      onUploadProgress: (e) => {
        const percent = Math.round((e.loaded * 100) / e.total);
        uploadBtn.innerHTML = `Uploading... (${percent}%)`;
      }
    });

    const videoUrl = `${apiUrl}${res.data.videoUrl}`;
    uploadedVideoContainer.innerHTML = `
      <h4>✅ Uploaded Video</h4>
      <video controls src="${videoUrl}"></video>
      <p><a href="${videoUrl}" target="_blank">Open in new tab</a></p>
    `;

    videoFile = null;
    videoInput.value = '';
    chooseBtn.innerHTML = '📁 Choose File';
    passwordInput.value = '';

    fetchVideos();
  } catch (err) {
    errorMsg.textContent = '❌ Upload failed';
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '⬆️ Upload Video';
  }
});

async function fetchVideos() {
  videoListContainer.innerHTML = 'Loading videos...';
  try {
    const res = await axios.get(`${apiUrl}/videos`);
    videoList = res.data;
    renderVideoList();
  } catch {
    videoListContainer.innerHTML = '❌ Failed to fetch video list';
  }
}

function renderVideoList() {
  videoListContainer.innerHTML = '';
  videoList.forEach(video => {
    const card = document.createElement('div');
    card.className = 'video-card';

    const media = video.view
      ? `<video controls src="${apiUrl}${video.url}"></video>`
      : `<div style="position: relative;"><img src="${apiUrl}${video.thumbnail}" />
         <div class="icon" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:50px;cursor:pointer;" onclick="toggleView('${video.name}')">▶️</div></div>`;

    card.innerHTML = `
      ${media}
      <p>${video.name}</p>
      <small>Uploaded: ${new Date(video.uploadDate).toLocaleString()}</small><br/>
      <small>Size: ${(video.size / (1024 * 1024)).toFixed(2)} MB</small>
      <div class="actions">
        <button onclick="deleteVideo('${video.name}')" style="background:#dc3545">🗑 Delete</button>
        <button onclick="renameVideo('${video.name}')" style="background:#ffc107; color:#000;">✏️ Rename</button>
      </div>
    `;
    videoListContainer.appendChild(card);
  });
}

window.deleteVideo = async (name) => {
  if (!confirm(`Delete video: ${name}?`)) return;
  try {
    await axios.delete(`${apiUrl}/videos/${name}`);
    fetchVideos();
  } catch {
    errorMsg.textContent = '❌ Failed to delete';
  }
};

window.renameVideo = async (oldName) => {
  const ext = oldName.substring(oldName.lastIndexOf('.'));
  const base = oldName.substring(0, oldName.lastIndexOf('.'));
  const input = prompt('Enter new name (without extension):', base);
  if (!input || input === base) return;
  const newName = input + ext;

  try {
    await axios.post(`${apiUrl}/rename`, { oldName, newName });
    fetchVideos();
  } catch {
    errorMsg.textContent = '❌ Rename failed';
  }
};

window.toggleView = (name) => {
  videoList = videoList.map(v => {
    if (v.name === name) v.view = !v.view;
    return v;
  });
  renderVideoList();
};

fetchVideos();
