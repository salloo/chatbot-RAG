// swagger.js
const swaggerJsDoc = require('swagger-jsdoc');

const swaggerOptions = {
    definition: {
        openapi: '3.0.0', // Specify the OpenAPI version
        info: {
            title: 'My API',
            version: '1.0.0',
            description: 'Chatbot for PBC app',
        },
        servers: [
            {
                url: process.env.PROJECT_URL + ":" + process.env.PORT, // Your server URL
            },
        ],
    },
    apis: ['./*.js'], // Path to the API docs
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
module.exports = swaggerDocs;
