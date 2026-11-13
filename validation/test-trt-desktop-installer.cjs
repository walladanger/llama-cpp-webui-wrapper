const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=path.join(__dirname,'trt-desktop-installer-fixture'),bin=path.join(dir,'bin');fs.mkdirSync(bin,{recursive:true});
const posix=p=>p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase());
const trace=path.join(dir,'trace.log'),osfile=path.join(dir,'os-release'),scriptfile=path.join(dir,'setup.sh'),launcher=path.join(dir,'managed/bin/trtllm-serve');
fs.writeFileSync(osfile,'ID=ubuntu\nVERSION_ID=26.04\n');
for(const cmd of ['apt-get','systemctl','usermod','nvidia-ctk','curl','gpg'])fs.writeFileSync(path.join(bin,cmd),'#!/bin/bash\necho "FORBIDDEN '+cmd+'" >> "$ROUTER_TRACE"\nexit 97\n');
fs.writeFileSync(path.join(bin,'docker'),`#!/bin/bash
printf '%s\\n' "$*" >> "$ROUTER_TRACE"
case "$1" in
 info) echo "$ROUTER_DOCKER_BACKEND";;
 pull) echo 'Fixture pull succeeded';;
 image) echo 'nvcr.io/nvidia/tensorrt-llm/release@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';;
 run) echo 'Fixture runtime verification';;
 *) exit 98;;
esac
`);
let source=fs.readFileSync(path.join(root,'tauri-shell/src/trt-install.sh'),'utf8');
source=source.replace('. /etc/os-release','. "$ROUTER_FIXTURE_OS"').replace('id "$user" >/dev/null','true # account identity is not the subject of this fixture').replaceAll('/opt/llama-router/trtllm/bin',JSON.stringify(posix(path.dirname(launcher))));
fs.writeFileSync(scriptfile,source);
const bash='C:/Program Files/Git/bin/bash.exe';
function run(backend){fs.writeFileSync(trace,'');return spawnSync(bash,['-c','export PATH="$ROUTER_BIN:$PATH"; chmod +x "$ROUTER_BIN"/*; exec bash "$ROUTER_SCRIPT" fixture-user'],{windowsHide:true,encoding:'utf8',env:{...process.env,ROUTER_DOCKER_BACKEND:backend,ROUTER_BIN:posix(bin),ROUTER_SCRIPT:posix(scriptfile),ROUTER_TRACE:posix(trace),ROUTER_FIXTURE_OS:posix(osfile)}});}
let result=run('Docker Desktop');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Reusing Docker Desktop/);assert.match(result.stdout,/ROUTER_STEP:6:/);assert.doesNotMatch(fs.readFileSync(trace,'utf8'),/FORBIDDEN/);assert.match(fs.readFileSync(launcher,'utf8'),/use_group=0/);
result=run('Native Docker');assert.notEqual(result.status,0);assert.match(result.stderr,/Native Docker setup supports Ubuntu 22.04 and 24.04/);assert.doesNotMatch(fs.readFileSync(trace,'utf8'),/FORBIDDEN/);
console.log('PASS: Docker Desktop branch completes the simulated setup on Ubuntu 26.04 without apt, service configuration or group changes; unsupported native setup stops before mutation. All Docker operations were stubbed.');
