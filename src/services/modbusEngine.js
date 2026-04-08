const ModbusRTU = require('modbus-serial');
const prisma = require('../config/prisma');

/**
 * PRODUCTION GRADE MODBUS ENGINE
 * Supports TCP/IP and RS485 Serial Communication
 */
class ModbusEngine {
    constructor() {
        this.clients = new Map();
        this.pollingInterval = null;
        this.io = null;
        this.isPolling = false;
    }

    init(io) {
        this.io = io;
        console.log('⚡ Modbus Engine Initialized. Awaiting Grid Telemetry...');
        setTimeout(() => this.startPolling(), 2000);
    }

    async connectToMeter(meter) {
        let client = this.clients.get(meter.id);
        if (client && client.isOpen) return client;

        const isSimMode = process.env.AUTO_SIMULATE_METER === 'true';
        const isLocalHost = meter.ipAddress === '127.0.0.1' || meter.ipAddress === 'localhost';

        if (isSimMode || (isLocalHost && process.env.NODE_ENV !== 'production')) {
             console.log(`🧪 [SIMULATOR_ACTIVE] Generating synthetic data for Meter: ${meter.meterId}`);
             return { isOpen: true, isSimulator: true };
        }

        client = new ModbusRTU();
        try {
            if (meter.connectionType === 'TCP') {
                const port = Number(meter.port) || 502;
                await client.connectTCP(meter.ipAddress, { port });
            } else {
                await client.connectRTUBuffered(meter.comPort, {
                    baudRate: Number(meter.baudRate) || 9600,
                    dataBits: Number(meter.dataBits) || 8,
                    stopBits: Number(meter.stopBits) || 1,
                    parity: meter.parity || 'none'
                });
            }
            client.setID(Number(meter.modbusAddress) || 1);
            client.setTimeout(3000);
            this.clients.set(meter.id, client);
            return client;
        } catch (error) {
            console.error(`❌ Connection Error (Meter ${meter.meterId}):`, error.message);
            throw new Error(`[HW_LINK_FAILED] ${error.message}`);
        }
    }

    async readMeterData(meter) {
        const client = await this.connectToMeter(meter);
        if (!client) return null;

        const results = {};
        if (client.isSimulator) {
            const regs = (meter.registers && meter.registers.length > 0) ? meter.registers : [
                { label: 'Voltage', address: '1' },
                { label: 'Current', address: '2' },
                { label: 'Energy', address: '3' },
                { label: 'Power', address: '4' }
            ];
            for (const reg of regs) {
                if (reg.label.includes('Voltage') || reg.label === 'V') results[reg.label] = parseFloat((230 + Math.random() * 5).toFixed(2));
                else if (reg.label.includes('Current') || reg.label === 'A') results[reg.label] = parseFloat((5 + Math.random() * 2).toFixed(2));
                else if (reg.label.includes('Energy') || reg.label === 'KWH') results[reg.label] = parseFloat((1200 + (Date.now() % 10000) / 100).toFixed(2));
                else if (reg.label.includes('Power') || reg.label === 'KW') results[reg.label] = parseFloat((1.2 + Math.random() * 0.5).toFixed(2));
                else results[reg.label] = Math.floor(Math.random() * 100);
            }
            return results;
        }

        if (!meter.registers || meter.registers.length === 0) return null;

        for (const reg of meter.registers) {
            try {
                let data;
                const regAddress = parseInt(reg.address);
                const regCount = (reg.dataType === 'Float' || reg.dataType === 'Int32') ? 2 : 1;
                if (Number(reg.functionCode) === 3) data = await client.readHoldingRegisters(regAddress, regCount);
                else data = await client.readInputRegisters(regAddress, regCount);

                if (data && (data.buffer || data.data)) {
                    const key = reg.label;
                    if (reg.dataType === 'Float' && data.buffer) results[key] = parseFloat(data.buffer.readFloatBE(0).toFixed(2));
                    else if (reg.dataType === 'Int32' && data.buffer) results[key] = data.buffer.readInt32BE(0);
                    else if (reg.dataType === 'Int16' && data.buffer) results[key] = data.buffer.readInt16BE(0);
                    else if (data.data) results[key] = data.data[0];
                }
            } catch (error) {
                results[reg.label] = 0;
                if (error.message.includes('TIMEOUT')) this.clients.delete(meter.id);
            }
        }
        return results;
    }

    async startPolling() {
        if (this.isPolling) return;
        this.isPolling = true;
        const intervalMs = Number(process.env.POLLING_INTERVAL_MS) || 5000;
        console.log(`🚀 [MODBUS_ENGINE] Starting polling loop (${intervalMs}ms)...`);

        const poll = async () => {
            try {
                const meters = await prisma.meter.findMany({
                    include: { 
                        registers: true, 
                        consumer: { include: { user: { select: { name: true } } } } 
                    }
                });

                for (const meter of meters) {
                    try {
                        const data = await this.readMeterData(meter);
                        
                        // Check if we got any valid data
                        if (data && Object.keys(data).length > 0) {
                            console.log(`✅ [${meter.meterId}] Data Received:`, data);
                            
                            const energyVal = parseFloat(data['Energy'] || data['KWH'] || data['Total Energy'] || data['energy'] || 0);
                            const voltageVal = parseFloat(data['Voltage'] || data['V'] || data['voltage'] || 0);
                            const currentVal = parseFloat(data['Current'] || data['A'] || data['current'] || 0);
                            const powerVal = parseFloat(data['Power'] || data['KW'] || data['power'] || 0);

                            // Update Database: Reading + Status
                            await Promise.all([
                                prisma.meterReading.create({
                                    data: { 
                                        meterId: meter.id, 
                                        energy: energyVal, 
                                        voltage: voltageVal || null, 
                                        current: currentVal || null, 
                                        power: powerVal || null, 
                                        status: 'Online' 
                                    }
                                }),
                                prisma.meter.update({ 
                                    where: { id: meter.id }, 
                                    data: { status: 'Active', lastUpdated: new Date() } 
                                }),
                                energyVal > 0 ? prisma.consumer.update({ 
                                    where: { id: meter.consumerId }, 
                                    data: { lastReading: energyVal } 
                                }) : Promise.resolve()
                            ]);

                            console.log(`📡 [${meter.meterId}] Status: Active`);

                            // Emit to UI
                            if (this.io) {
                                this.io.emit('meterUpdate', {
                                    meterId: meter.meterId,
                                    meterName: meter.meterName,
                                    consumerName: meter.consumer?.user?.name || 'Unknown',
                                    ...data,
                                    status: 'Active',
                                    lastUpdated: new Date()
                                });
                            }
                        } else {
                            // No data received from modbus
                            console.warn(`⚠️ [${meter.meterId}] No data received. Setting status to Failed.`);
                            await prisma.meter.update({ 
                                where: { id: meter.id }, 
                                data: { status: 'Failed', lastUpdated: new Date() } 
                            });
                            this.io?.emit('meterUpdate', { meterId: meter.meterId, status: 'Failed' });
                        }
                    } catch (err) {
                        console.error(`🚨 [${meter.meterId}] POLLING_FAILED:`, err.message);
                        await prisma.meter.update({ 
                            where: { id: meter.id }, 
                            data: { status: 'Failed', lastUpdated: new Date() } 
                        });
                        this.io?.emit('meterUpdate', { meterId: meter.meterId, status: 'Failed' });
                    }
                }
            } catch (error) {
                console.error('🔥 [MODBUS_ENGINE] Critical Loop Error:', error.message);
            } finally {
                setTimeout(poll, intervalMs);
            }
        };

        poll();
    }
}

module.exports = new ModbusEngine();
