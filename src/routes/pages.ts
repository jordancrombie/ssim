import { Router, Request, Response } from 'express';
import { getAllProviders } from '../config/oidc';

const router = Router();

// Home page
router.get('/', (req: Request, res: Response) => {
  const isAuthenticated = !!req.session.userInfo;
  res.render('home', {
    isAuthenticated,
    userInfo: req.session.userInfo,
  });
});

// Login page with provider selection
router.get('/login', (req: Request, res: Response) => {
  if (req.session.userInfo) {
    return res.redirect('/profile');
  }

  const providers = getAllProviders();
  res.render('login', { providers });
});

// Profile page (shows OIDC info after login)
router.get('/profile', (req: Request, res: Response) => {
  if (!req.session.userInfo) {
    return res.redirect('/login');
  }

  res.render('profile', {
    userInfo: req.session.userInfo,
    tokenSet: req.session.tokenSet,
    providerId: req.session.providerId,
  });
});

export default router;
