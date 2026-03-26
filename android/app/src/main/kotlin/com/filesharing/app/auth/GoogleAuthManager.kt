package com.filesharing.app.auth

import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class GoogleAuthManager(private val context: Context) {

    companion object {
        private const val DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
    }

    private val signInOptions: GoogleSignInOptions = GoogleSignInOptions.Builder(
        GoogleSignInOptions.DEFAULT_SIGN_IN
    )
        .requestScopes(Scope(DRIVE_SCOPE))
        .requestEmail()
        .build()

    val signInClient: GoogleSignInClient = GoogleSignIn.getClient(context, signInOptions)

    fun isSignedIn(): Boolean {
        val account = GoogleSignIn.getLastSignedInAccount(context) ?: return false
        return GoogleSignIn.hasPermissions(account, Scope(DRIVE_SCOPE))
    }

    fun getSignedInAccount(): GoogleSignInAccount? =
        GoogleSignIn.getLastSignedInAccount(context)

    fun getSignInIntent(): Intent = signInClient.signInIntent

    /**
     * IO 스레드에서 실행해야 합니다.
     * 401 응답 시 [clearAndRefreshToken]을 사용하세요.
     */
    suspend fun getAccessToken(): String = withContext(Dispatchers.IO) {
        val account = GoogleSignIn.getLastSignedInAccount(context)
            ?: error("Google 계정이 로그인되지 않았습니다.")
        GoogleAuthUtil.getToken(
            context,
            account.account ?: error("계정 정보를 가져올 수 없습니다."),
            "oauth2:$DRIVE_SCOPE"
        )
    }

    /**
     * 만료된 토큰을 무효화하고 새 토큰을 발급받습니다.
     */
    suspend fun clearAndRefreshToken(): String = withContext(Dispatchers.IO) {
        val account = GoogleSignIn.getLastSignedInAccount(context)
            ?: error("Google 계정이 로그인되지 않았습니다.")
        val androidAccount = account.account ?: error("계정 정보를 가져올 수 없습니다.")
        val scope = "oauth2:$DRIVE_SCOPE"
        val oldToken = GoogleAuthUtil.getToken(context, androidAccount, scope)
        GoogleAuthUtil.clearToken(context, oldToken)
        GoogleAuthUtil.getToken(context, androidAccount, scope)
    }

    fun signOut() {
        signInClient.signOut()
    }
}
