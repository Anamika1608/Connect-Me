let params = {
    // mediasoup params
    encodings: [
        {
            rid: 'r0',
            maxBitrate: 100000,
            scalabilityMode: 'S1T3',
        },
        {
            rid: 'r1',
            maxBitrate: 300000,
            scalabilityMode: 'S1T3',
        },
        {
            rid: 'r2',
            maxBitrate: 900000,
            scalabilityMode: 'S1T3',
        },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
        videoGoogleStartBitrate: 1000
    }
}


const streamSuccess = async (stream, videoRef) => {
    if (videoRef.current) {
        videoRef.current.srcObject = stream;
    }
    const track = stream.getVideoTracks()[0];
    params = {
        track,
        ...params
    };
};

const getLocalStream = (videoRef) => {
    navigator.getUserMedia(
        {
            audio: false,
            video: {
                width: { min: 640, max: 1920 },
                height: { min: 400, max: 1080 },
            }
        },
        (stream) => streamSuccess(stream, videoRef),
        (error) => {
            console.log("Error in getting local stream", error.message);
        }
    );
};

export default getLocalStream;
