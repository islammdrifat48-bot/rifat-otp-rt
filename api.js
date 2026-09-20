const axiosInstance = require('axios');
const config = require('./config');

const getHeaders = () => ({
    'mauthapi': config.VOLTX_API_KEY,
    'Content-Type': 'application/json'
});

async function getLiveAccess() {
    try {
        const response = await axiosInstance.get(`${config.BASE_URL}/liveaccess`, {
            headers: getHeaders()
        });
        return response.data;
    } catch (error) {
        console.error('API getLiveAccess error:', error.message);
        return null;
    }
}

async function getNewNumber(rangeId) {
    try {
        const payload = {};
        if (rangeId) {
            payload.rid = rangeId;
        }

        const response = await axiosInstance.post(`${config.BASE_URL}/getnum`, payload, {
            headers: getHeaders()
        });
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('API getNewNumber error status:', error.response.status);
            console.error('API getNewNumber error data:', error.response.data);
        } else {
            console.error('API getNewNumber error:', error.message);
        }
        return null;
    }
}

async function getSuccessOtp() {
    try {
        const response = await axiosInstance.get(`${config.BASE_URL}/success-otp`, {
            headers: getHeaders()
        });
        return response.data;
    } catch (error) {
        console.error('API getSuccessOtp error:', error.message);
        return null;
    }
}

async function getConsoleData() {
    try {
        const response = await axiosInstance.get(`${config.BASE_URL}/console`, {
            headers: getHeaders()
        });
        return response.data;
    } catch (error) {
        console.error('API getConsoleData error:', error.message);
        return null;
    }
}

module.exports = {
    getLiveAccess,
    getNewNumber,
    getSuccessOtp,
    getConsoleData
};
