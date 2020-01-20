var webglPlayer, canvas, videoWidth, videoHeight, yLength, uvLength;
var LOG_LEVEL_JS = 0;
var LOG_LEVEL_WASM = 1;
var LOG_LEVEL_FFMPEG = 2;
var DECODER_H264 = 0;
var DECODER_H265 = 1;

var decoder_type = DECODER_H265;

function handleVideoFiles(files) {
    var file_list = files;
    var file_idx = 0;
    decode_seq(file_list, file_idx);
}

function setDecoder(type) {
    decoder_type = type;
}

function decode_seq(file_list, file_idx) {
    if (file_idx >= file_list.length)
        return;
    var file = file_list[file_idx];
    var start_time = new Date();

    var videoSize = 0;
    var videoCallback = Module.addFunction(function (addr_y, addr_u, addr_v, stride_y, stride_u, stride_v, width, height, pts) {
        console.log("[%d]In video callback, size = %d * %d, pts = %d", ++videoSize, width, height, pts)
        let size = width * height + (width / 2)  * (height / 2) + (width / 2)  * (height / 2)
        let data = new Uint8Array(size)
        let pos = 0
        for(let i=0; i< height; i++) {
            let src = addr_y + i * stride_y
            let tmp = HEAPU8.subarray(src, src + width)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        for(let i=0; i< height / 2; i++) {
            let src = addr_u + i * stride_u
            let tmp = HEAPU8.subarray(src, src + width / 2)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        for(let i=0; i< height / 2; i++) {
            let src = addr_v + i * stride_v
            let tmp = HEAPU8.subarray(src, src + width / 2)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        var obj = {
            data: data,
            width,
            height
        }
        displayVideoFrame(obj);
    });

    var ret = Module._openDecoder(decoder_type, videoCallback, LOG_LEVEL_WASM)
    if(ret == 0) {
        console.log("openDecoder success");
    } else {
        console.error("openDecoder failed with error", ret);
        return;
    }

    var readerIndex = 0
    var CHUNK_SIZE = 4096;
    var i_stream_size = 0;
    var filePos = 0;
    var totalSize = 0
    var pts = 0
    do {
        var reader = new FileReader();
        reader.onload = function() {
            var typedArray = new Uint8Array(this.result);
            var size = typedArray.length
            var cacheBuffer = Module._malloc(size);
            Module.HEAPU8.set(typedArray, cacheBuffer);
            totalSize += size
            // console.log("[" + (++readerIndex) + "] Read len = ", size + ", Total size = " + totalSize)

            Module._decodeData(cacheBuffer, size, pts++)
            if (cacheBuffer != null) {
                Module._free(cacheBuffer);
                cacheBuffer = null;
            }
            if(size < CHUNK_SIZE) {
                console.log('Flush frame data')
                Module._flushDecoder();
                Module._closeDecoder();
            }
        }
        i_stream_size  = read_file_slice(reader, file, filePos, CHUNK_SIZE);
        filePos += i_stream_size;
    } while (i_stream_size > 0);

}

//从地址 start_addr 开始读取 size 大小的数据
function read_file_slice(reader, file, start_addr, size) {
    var file_size = file.size;
    var file_slice;

    if (start_addr > file_size - 1) {
        return 0;
    }
    else if (start_addr + size > file_size - 1) {
        file_slice = blob_slice(file, start_addr, file_size);
        reader.readAsArrayBuffer(file_slice);
        return file_size - start_addr;
    }
    else {
        file_slice = blob_slice(file, start_addr, start_addr + size);
        reader.readAsArrayBuffer(file_slice);
        return size;
    }
}

function blob_slice(blob, start_addr, end_addr) {
    if (blob.slice) {
        return blob.slice(start_addr, end_addr);
    }
    // compatible firefox
    if (blob.mozSlice) {
        return blob.mozSlice(start_addr, end_addr);
    }
    // compatible webkit
    if (blob.webkitSlice) {
        return blob.webkitSlice(start_addr, end_addr);
    }
    return null;
}

function displayVideoFrame(obj) {
    var data = new Uint8Array(obj.data);
    var width = obj.width;
    var height = obj.height;
    var yLength = width * height;
    var uvLength = (width / 2) * (height / 2);
    if(!webglPlayer) {
        const canvasId = "playCanvas";
        canvas = document.getElementById(canvasId);
        webglPlayer = new WebGLPlayer(canvas, {
            preserveDrawingBuffer: false
        });
    }
    webglPlayer.renderFrame(data, width, height, yLength, uvLength);
}