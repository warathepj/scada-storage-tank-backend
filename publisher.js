const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MQTT client setup
const MQTT_BROKER_URL = 'mqtt://test.mosquitto.org:1883';  // Changed to public test broker
const MQTT_TOPIC = 'tankscape/tanks';
const MQTT_ALERT_TOPIC = 'tankscape/alerts';

// Add MQTT connection options
const mqttOptions = {
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000,
    clientId: `tankscape_publisher_${Math.random().toString(16).slice(3)}` // Add random client ID to avoid conflicts
};

const client = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

// Configure logging
const LOG_DIR = path.join(__dirname, 'logs');
const TANK_ALERT_LOG = path.join(LOG_DIR, 'tank-alerts.log');

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

// Log function
function logAlert(data) {
    const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(data, null, 2)}\n`;
    fs.appendFile(TANK_ALERT_LOG, logEntry, (err) => {
        if (err) console.error('Error writing to log:', err);
    });
}

// Add this helper function for formatted console logging
function logToConsole(type, message, data = null) {
    const timestamp = new Date().toISOString();
    const colorCodes = {
        INFO: '\x1b[36m',    // Cyan
        SUCCESS: '\x1b[32m', // Green
        WARNING: '\x1b[33m', // Yellow
        ERROR: '\x1b[31m',   // Red
        RESET: '\x1b[0m'     // Reset
    };

    console.log(`${colorCodes[type]}[${timestamp}] ${message}${colorCodes.RESET}`);
    if (data) {
        console.log(colorCodes[type], JSON.stringify(data, null, 2), colorCodes.RESET);
    }
}

// MQTT connection handling
client.on('connect', () => {
    logToConsole('SUCCESS', 'Connected to MQTT broker');
});

client.on('error', (error) => {
    logToConsole('ERROR', 'MQTT Error:', error.message);
    logAlert({
        event: 'MQTT_ERROR',
        timestamp: new Date().toISOString(),
        error: error.message
    });
});

// Tank level monitoring
const LOW_LEVEL_THRESHOLD = 25; // 25% of tank capacity
const HIGH_LEVEL_THRESHOLD = 90; // 90% of tank capacity

function checkTankLevels(rooms) {
    const lowLevelTanks = rooms.reduce((acc, room) => {
        const lowTanks = room.tanks.filter(tank => tank.level <= LOW_LEVEL_THRESHOLD);
        
        if (lowTanks.length > 0) {
            acc.push({
                roomId: room.id,
                totalTanks: room.tanks.length,
                lowLevelTanks: lowTanks.length,
                tanks: lowTanks.map(tank => ({
                    id: tank.id,
                    name: tank.name,
                    level: tank.level,
                    lastUpdated: tank.lastUpdated,
                    threshold: LOW_LEVEL_THRESHOLD,
                    deficit: Number((LOW_LEVEL_THRESHOLD - tank.level).toFixed(2))
                }))
            });
        }
        return acc;
    }, []);

    if (lowLevelTanks.length > 0) {
        const alertData = {
            event: 'LOW_LEVEL_ALERT',
            timestamp: new Date().toISOString(),
            details: {
                timestamp: new Date().toISOString(),
                totalRooms: rooms.length,
                totalTanks: rooms.reduce((sum, room) => sum + room.tanks.length, 0),
                rooms: lowLevelTanks
            },
            mqttTopic: MQTT_ALERT_TOPIC
        };
        
        client.publish(MQTT_ALERT_TOPIC, JSON.stringify(alertData));
        logAlert(alertData);
    }
}

// API Endpoints
app.post('/publish', (req, res) => {
    try {
        const data = req.body;
        
        // Log received data
        logToConsole('INFO', 'Received tank data:', {
            timestamp: data.timestamp,
            totalRooms: data.rooms.length,
            totalTanks: data.rooms.reduce((sum, room) => sum + room.tanks.length, 0)
        });

        // Publish all tank data to MQTT
        client.publish(MQTT_TOPIC, JSON.stringify(data));
        logToConsole('SUCCESS', `Published data to ${MQTT_TOPIC}`);
        
        // Filter rooms for low-level tanks for alerts
        const lowLevelData = {
            ...data,
            rooms: data.rooms.map(room => ({
                ...room,
                tanks: room.tanks.filter(tank => tank.level <= LOW_LEVEL_THRESHOLD)
            })).filter(room => room.tanks.length > 0)
        };

        // Check tank levels and generate alerts if there are low-level tanks
        if (lowLevelData.rooms.length > 0) {
            logToConsole('WARNING', 'Low level tanks detected:', {
                totalLowLevelTanks: lowLevelData.rooms.reduce(
                    (sum, room) => sum + room.tanks.length, 0
                ),
                tanks: lowLevelData.rooms.map(room => 
                    room.tanks.map(tank => ({
                        roomId: room.id,
                        tankId: tank.id,
                        level: tank.level
                    }))
                ).flat()
            });
            checkTankLevels(data.rooms);
        }
        
        res.status(200).json({ message: 'Data published successfully' });
    } catch (error) {
        logToConsole('ERROR', 'Error publishing data:', error);
        logAlert({
            event: 'ERROR',
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: 'Failed to publish data' });
    }
});

// Start server
app.listen(PORT, () => {
    logToConsole('SUCCESS', `Publisher service running on port ${PORT}`);
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
}); // Added missing closing brace

