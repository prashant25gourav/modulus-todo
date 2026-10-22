import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import pinoHttp from 'pino-http';

describe('HTTP Logger Redaction', () => {
  it('should redact Authorization header and never leak the token in log output', async () => {
    let logOutput = '';
    const destinationStream = {
      write(msg: string) {
        logOutput += msg;
      },
    };

    const app = express();

    // Configure logger with the exact redaction paths used in the app
    app.use(
      pinoHttp({
        logger: pino(
          {
            level: 'info',
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.password',
                'password',
                'req.body.password',
                '*.passwordHash',
                'passwordHash',
              ],
              censor: '[REDACTED]',
            },
          },
          destinationStream
        ),
        serializers: {
          req(req) {
            const sanitized = pino.stdSerializers.req(req);
            delete (sanitized as unknown as Record<string, unknown>).body;
            return sanitized;
          },
        },
      })
    );

    app.use(express.json());

    app.post('/api/test-log', (req, res) => {
      res.setHeader('Set-Cookie', 'secret_session_token=session_xyz987654');
      res.status(200).json({ status: 'ok' });
    });

    const secretToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive_payload_data.secret_signature_string';
    const secretPassword = 'myVerySecretPassword123!';
    const secretCookie = 'session_id=ultra_confidential_session_value';

    await request(app)
      .post('/api/test-log')
      .set('Authorization', `Bearer ${secretToken}`)
      .set('Cookie', secretCookie)
      .send({
        email: 'user@example.com',
        password: secretPassword,
      });

    // Assert that sensitive token does not appear in log output
    expect(logOutput).not.toContain(secretToken);

    // Assert that passwords never appear in log output
    expect(logOutput).not.toContain(secretPassword);

    // Assert that session cookies do not appear in log output
    expect(logOutput).not.toContain('ultra_confidential_session_value');
    expect(logOutput).not.toContain('session_xyz987654');

    // Assert that redactions were applied
    expect(logOutput).toContain('[REDACTED]');

    // Assert that request body was not logged
    expect(logOutput).not.toContain('user@example.com');
  });
});
