// ============================================================
// GasSync Backend - Swagger Configuration
// ============================================================

import swaggerJSDoc from 'swagger-jsdoc';
import config from '../config';

const swaggerDefinition: swaggerJSDoc.SwaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: '⛽ GasSync API',
    version: '1.0.0',
    description: `
# GasSync — US Gas Price Tracker & Bill Intelligence API

Production-grade REST API for the GasSync mobile application.

## Features
- 🔐 **Authentication** — JWT-based auth with refresh tokens
- ⛽ **Gas Stations** — CRUD + geospatial nearby search
- 💰 **Gas Prices** — Live prices, trends, state comparison, user reports
- 🧾 **Bill Processing** — Upload receipts, OCR extraction, spending analytics
- 📊 **Price History** — Aggregated trends with multiple time periods

## Authentication
Most endpoints require a JWT Bearer token. Get one by registering or logging in.

\`\`\`
Authorization: Bearer <your_access_token>
\`\`\`
    `,
    contact: {
      name: 'GasSync Team',
      email: 'support@gassync.app',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: `http://localhost:${config.port}`,
      description: 'Development server',
    },
    {
      url: 'https://api.gassync.app',
      description: 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT access token',
      },
    },
    schemas: {
      // ---- User ----
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6651a1b2c3d4e5f6a7b8c9d0' },
          email: { type: 'string', format: 'email', example: 'john@example.com' },
          displayName: { type: 'string', example: 'John Doe' },
          avatarUrl: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          preferredFuelType: {
            type: 'string',
            enum: ['regular', 'midgrade', 'premium', 'diesel'],
            example: 'regular',
          },
          defaultZipCode: { type: 'string', example: '77001' },
          defaultState: { type: 'string', example: 'TX' },
          role: { type: 'string', enum: ['user', 'admin'] },
          isEmailVerified: { type: 'boolean' },
          lastLoginAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Login successful' },
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
            },
          },
        },
      },
      // ---- Gas Station ----
      GasStation: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string', example: 'Shell Gas Station' },
          brand: { type: 'string', example: 'Shell' },
          address: { type: 'string', example: '123 Main St' },
          city: { type: 'string', example: 'Houston' },
          state: { type: 'string', example: 'TX' },
          zipCode: { type: 'string', example: '77001' },
          location: {
            type: 'object',
            properties: {
              type: { type: 'string', example: 'Point' },
              coordinates: {
                type: 'array',
                items: { type: 'number' },
                example: [-95.3698, 29.7604],
              },
            },
          },
          amenities: { type: 'array', items: { type: 'string' } },
          isActive: { type: 'boolean' },
          lastPriceUpdate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      GasStationInput: {
        type: 'object',
        required: ['name', 'brand', 'address', 'city', 'state', 'zipCode', 'location'],
        properties: {
          name: { type: 'string', example: 'Shell Gas Station' },
          brand: { type: 'string', example: 'Shell' },
          address: { type: 'string', example: '123 Main St' },
          city: { type: 'string', example: 'Houston' },
          state: { type: 'string', example: 'TX' },
          zipCode: { type: 'string', example: '77001' },
          location: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['Point'], example: 'Point' },
              coordinates: {
                type: 'array',
                items: { type: 'number' },
                example: [-95.3698, 29.7604],
                description: '[longitude, latitude]',
              },
            },
          },
          amenities: {
            type: 'array',
            items: { type: 'string' },
            example: ['car_wash', 'convenience_store', 'atm'],
          },
          operatingHours: {
            type: 'object',
            properties: {
              open: { type: 'string', example: '06:00' },
              close: { type: 'string', example: '22:00' },
              is24Hours: { type: 'boolean', example: false },
            },
          },
        },
      },
      PaginatedStations: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/GasStation' },
          },
          meta: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' },
            },
          },
        },
      },
      // ---- Gas Price ----
      GasPrice: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          station: { type: 'string', description: 'Station ObjectId' },
          fuelType: {
            type: 'string',
            enum: ['regular', 'midgrade', 'premium', 'diesel'],
          },
          price: { type: 'number', example: 3.459 },
          currency: { type: 'string', example: 'USD' },
          source: {
            type: 'string',
            enum: ['api_eia', 'api_collect', 'user_bill', 'user_report', 'admin'],
          },
          region: { type: 'string', example: 'TX' },
          recordedAt: { type: 'string', format: 'date-time' },
          isVerified: { type: 'boolean' },
        },
      },
      // ---- Bill ----
      Bill: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          user: { type: 'string' },
          station: { type: 'string', nullable: true },
          imageUrl: { type: 'string' },
          stationName: { type: 'string', nullable: true },
          fuelType: { type: 'string', enum: ['regular', 'midgrade', 'premium', 'diesel'], nullable: true },
          pricePerGallon: { type: 'number', nullable: true, example: 3.459 },
          totalGallons: { type: 'number', nullable: true, example: 12.345 },
          totalAmount: { type: 'number', nullable: true, example: 42.67 },
          billDate: { type: 'string', format: 'date', nullable: true },
          ocrRawText: { type: 'string', nullable: true },
          ocrConfidence: { type: 'number', nullable: true },
          status: {
            type: 'string',
            enum: ['uploading', 'processing', 'extracted', 'verified', 'failed'],
          },
          userCorrected: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      // ---- Error ----
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Error message' },
          errors: { type: 'object', nullable: true },
        },
      },
    },
  },
  tags: [
    { name: 'Auth', description: 'Authentication & user management' },
    { name: 'Gas Stations', description: 'Gas station management & search' },
    { name: 'Gas Prices', description: 'Gas price data, trends & comparisons' },
    { name: 'Bills', description: 'Bill upload, OCR processing & analytics' },
  ],
};

const swaggerOptions: swaggerJSDoc.Options = {
  swaggerDefinition,
  apis: ['./src/controllers/*.ts', './src/routes/*.ts'],
};

export const swaggerSpec = swaggerJSDoc(swaggerOptions);
