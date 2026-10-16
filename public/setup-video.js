const setupDialog=document.getElementById('setup-video-dialog');
const setupVideo=document.getElementById('setup-video');
const setupVideoStatus=document.getElementById('setup-video-status');
for(const button of document.querySelectorAll('[data-open-setup-video]'))button.addEventListener('click',()=>{
 const installDialog=document.getElementById('install-dialog');if(installDialog?.open)installDialog.close();
 if(!setupVideo.getAttribute('src'))setupVideo.src=setupVideo.dataset.src;
 setupDialog.showModal();
 setupVideo.play().catch(()=>{setupVideoStatus.textContent='Tap the play button to start. The written steps below are always available.';});
});
for(const id of ['close-setup-video','done-setup-video'])document.getElementById(id).addEventListener('click',()=>setupDialog.close());
setupDialog.addEventListener('close',()=>setupVideo.pause());
setupVideo.addEventListener('playing',()=>{setupVideoStatus.textContent='';});
setupVideo.addEventListener('error',()=>{setupVideoStatus.textContent='The video could not load. You can still follow all the steps below.';});
