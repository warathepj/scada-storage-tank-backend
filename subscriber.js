const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

// MQTT client setup
const MQTT_BROKER_URL = 'mqtt://test.mosquitto.org:1883';
const MQTT_TOPICS = ['tankscape/alerts'];

// MQTT connection options
const colorCodes = {
    INFO: '\x1b[36m',    // Cyan
    SUCCESS: '\x1b[32m', // Green
    WARNING: '\x1b[33m', // Yellow
    ERROR: '\x1b[31m',   // Red
    RESET: '\x1b[0m'     // Reset
};

const mqttOptions = {
    clean: true,
    clientId: `tankscape_subscriber_${Math.random().toString(16).slice(3)}` // Add random client ID
};

// Initialize MQTT client
const client = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

function logToConsole(type, message, data) {
    const timestamp = new Date().toISOString();
    console.log(`${colorCodes[type]}[${timestamp}] ${message}${colorCodes.RESET}`);
    if (data) {
        console.log(colorCodes[type], JSON.stringify(data, null, 2), colorCodes.RESET);
    }
}

// MQTT connection handling
client.on('connect', () => {
    logToConsole('SUCCESS', 'Connected to MQTT broker');
    // Subscribe to both topics
    MQTT_TOPICS.forEach(topic => {
        client.subscribe(topic, (err) => {
            if (err) {
                logToConsole('ERROR', `Failed to subscribe to ${topic}:`, err);
            } else {
                logToConsole('SUCCESS', `Subscribed to ${topic}`);
            }
        });
    });
});

// Message handling
client.on('message', (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        logToConsole('INFO', `Received message on ${topic}:`, data);
    } catch (error) {
        logToConsole('ERROR', `Failed to parse message on ${topic}:`, message.toString());
    }
});

// Error handling
client.on('error', (error) => {
    logToConsole('ERROR', 'MQTT Error:', error.message);
});

// Handle process termination
process.on('SIGTERM', () => {
    logToConsole('WARNING', 'Received SIGTERM signal. Shutting down...');
    client.end();
    process.exit(0);
    });

process.on('SIGINT', () => {
    logToConsole('WARNING', 'Received SIGINT signal. Shutting down...');
    client.end();
    process.exit(0);
})
