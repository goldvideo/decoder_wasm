var CHUNK_SIZE = 4096;
var file;
var filePos = 0;
var audioContext;
var audioSource;
var fileBuffer = [];
var audioEl;
var mediaSource;
var sourceBuffer;
var isMSEStart = false;
var audioDecoder = 0;//0 - audio context; 1 - media source extention
var scriptBuffer;
var scriptPos = 0;
const DECODER_WEBAUDIO = 0;
const DECODER_MSE = 1;

function setAudioDecoder(decoder) {
    audioDecoder = decoder
}

function handleAudioFiles(files) {
    var file_list = files;
    var file_idx = 0;
    loadFile(file_list, file_idx);
}

function initWebAudio() {
    console.log('Init audio context')
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

function initMSE() {
    mediaSource = new MediaSource();
    mediaSource.addEventListener('sourceopen', sourceOpenCallback, false);
    mediaSource.addEventListener('webkitsourceopen', sourceOpenCallback, false);
    mediaSource.addEventListener('sourceclose', sourceCloseCallback, false);
    mediaSource.addEventListener('webkitsourceclose', sourceCloseCallback, false);
    mediaSource.addEventListener('sourceended', sourceEndedCallback, false);
    mediaSource.addEventListener('webkitsourceended', sourceEndedCallback, false);

    audioEl = document.createElement('audio');
    audioEl.src = window.URL.createObjectURL(mediaSource);

    initWebAudio();
    var source = audioContext.createMediaElementSource(audioEl);
    source.connect(audioContext.destination);
}

function sourceOpenCallback() {
    console.log('Media Source Ready')
    sourceBuffer = mediaSource.addSourceBuffer('audio/aac')
    sourceBuffer.addEventListener('updateend', updateEndCallback, false)
    loadNextChunk();
}
function sourceCloseCallback() {
    console.log('Media Source closed')
}
function sourceEndedCallback() {
    console.log('Media Source ended')
}
function updateEndCallback() {
    console.log('load next buffer in update end')
    loadNextBuffer()
}

function loadFile(file_list, file_idx) {
    if (file_idx >= file_list.length)
        return;
    file = file_list[file_idx];
    CHUNK_SIZE = file.size
}

function showCurrentTime() {
    console.log(new Date(), audioContext.currentTime)
}

function playAudio() {
    setInterval(showCurrentTime, 1000)
    if (audioDecoder === DECODER_WEBAUDIO ) {
        loadNextChunk()
    } else if (audioDecoder === DECODER_MSE ) {
        initMSE()
    }
}

function fastForword() {
    console.log('fast forward')
    scriptPos += 50000
}

function webAudioCallback() {
    fileBuffer.push(this.result)
    var audioBuffer = mergeBuffer(fileBuffer, filePos)
    console.log('File buffer size = ', audioBuffer.byteLength)
    if(!audioContext) {
        initWebAudio();
    }
    audioContext.decodeAudioData(audioBuffer, buffer => {
        console.log(buffer)
        playAudioBuffer(buffer);
    });
    setTimeout(function() {
        loadNextChunk()
    }, 100);
}

function scriptNodeCallback() {
    fileBuffer.push(this.result)
    var audioBuffer = mergeBuffer(fileBuffer, filePos)
    console.log('File buffer size = ', audioBuffer.byteLength)
    if(!audioContext) {
        initWebAudio();
        let bufferSize = 16384
        let node = audioContext.createScriptProcessor(bufferSize, 2, 2);
        // audioSource = audioContext.createBufferSource();
        node.onaudioprocess = audioProcessingEvent=> {
            // let left = event.outputBuffer.getChannelData(0);
            // let right = event.outputBuffer.getChannelData(1);
            // if(scriptBuffer) {
            //     event.outputBuffer.copyToChannel(scriptBuffer.getChannelData(0), 0, 0)
            //     event.outputBuffer.copyToChannel(scriptBuffer.getChannelData(1), 1, 0)
            // }
            if(scriptBuffer) {
                var inputBuffer = scriptBuffer;
                var outputBuffer = audioProcessingEvent.outputBuffer;
                var lastLength = scriptBuffer.length - scriptPos
                var currentPos = scriptPos
                let copyLength = Math.min(lastLength, outputBuffer.length)
                scriptPos += copyLength
                for (var channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
                    var inputData = inputBuffer.getChannelData(channel);
                    var outputData = outputBuffer.getChannelData(channel);
                    for (var sample = 0; sample < copyLength; sample++) {
                        outputData[sample] = inputData[sample + currentPos];
                    }
                }
            }
        }
        // audioSource.connect(node)
        node.connect(audioContext.destination)
        // audioSource.start()
    }
    audioContext.decodeAudioData(audioBuffer, buffer => {
        console.log(buffer)
        scriptBuffer = buffer
        // playAudioBuffer(buffer);
    });
    setTimeout(function() {
        loadNextChunk()
    }, 100);
}

function mseCallback() {
    fileBuffer.push(this.result)
    if(!sourceBuffer.updating) {
        console.log('load next buffer in mse call back')
        loadNextBuffer()
    }
    if(!isMSEStart) {
        isMSEStart = true
        startMSEPlay()
    }
    setTimeout(function() {
        loadNextChunk()
    }, 100);
}

function loadNextBuffer() {
    if (fileBuffer.length) {
        sourceBuffer.appendBuffer(fileBuffer.shift());
    }
    if (filePos === file.size && !sourceBuffer.updating) {
        // else close the stream
        console.log('End Media Source')
        mediaSource.endOfStream();
    }
}

function startMSEPlay() {
    if (audioEl.paused) {
        audioEl.play();
    }
}

function loadNextChunk() {
    var reader = new FileReader();
    reader.onload = audioDecoder === DECODER_WEBAUDIO ? scriptNodeCallback : mseCallback
    var i_stream_size = read_file_slice(reader, file, filePos, CHUNK_SIZE);
    filePos += i_stream_size;
    console.log('Load file size', i_stream_size)
}

function appendBuffer(buffer1, buffer2) {
    var result = buffer2
    if(buffer1) {
        var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
        var buff1 = new Uint8Array(buffer1);
        var buff2 = new Uint8Array(buffer2);
        tmp.set(buff1, 0);
        tmp.set(buff2, buffer1.byteLength);
        result = tmp.buffer;
    }
    return result
}

function mergeBuffer(arr, size) {
    var res = new Uint8Array(size)
    var pos = 0;
    for(let i=0; i< arr.length; i++) {
        var tmp = new Uint8Array(arr[i])
        res.set(tmp, pos)
        pos += tmp.byteLength
    }
    return res.buffer
}

function playAudioBuffer(audioBuffer) {
    // Adding a bit of  scheduling so that we won't have single digit milisecond overlaps.
    // Thanks to Chris Wilson for his suggestion.
    var scheduledTime = 0.015;
    if(audioSource) {
        audioSource.stop(scheduledTime);
    }
    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(audioContext.destination);
    var currentTime = audioContext.currentTime + 0.010 || 0;
    var startTime = scheduledTime - 0.005;
    var offset = currentTime;
    var duration = audioBuffer.duration - currentTime
    console.log(startTime, offset, duration)
    audioSource.start(startTime, offset);
    // audioSource.playbackRate.value = 1;
}